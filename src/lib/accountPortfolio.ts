import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  parseAbiItem,
  type Address,
} from 'viem';
import { getArcConfig } from './arcConfig';
import { prestoMarketAbi } from './contracts';
import type { AppMarket } from './appState';
import type { PortfolioActivity, Position } from './portfolio';

const ARC_CHAIN_ID = 5042002;
const activityBlockWindow = BigInt(10_000);

export type AccountMarketPreview = {
  marketId: string;
  yesShares: string;
  noShares: string;
  claimable: string;
  refundable: string;
  hasClaimed: boolean;
};

export type AccountPortfolioSnapshot = {
  positions: Position[];
  activity: PortfolioActivity[];
  previews: Record<string, AccountMarketPreview>;
};

const sharesBoughtEvent = parseAbiItem('event SharesBought(address indexed buyer, address indexed recipient, uint8 indexed outcome, uint256 amount)');
const claimedEvent = parseAbiItem('event Claimed(address indexed user, uint256 amount, uint256 fee)');
const refundedEvent = parseAbiItem('event Refunded(address indexed user, uint256 amount)');

function formatUsdc(value: bigint) {
  return `$${Number(formatUnits(value, 6)).toFixed(2)}`;
}

function formatShares(value: bigint) {
  return Number(formatUnits(value, 6)).toFixed(2);
}

function getPositionStatus(market: AppMarket, claimable: bigint, refundable: bigint): Position['status'] {
  if (claimable > BigInt(0) || refundable > BigInt(0)) return 'Claimable';
  if (market.status === 'Open' || market.status === 'Closing soon') return 'Open';
  return 'Watching';
}

function createClient() {
  const config = getArcConfig();

  if (!config.rpcUrl) {
    return null;
  }

  return createPublicClient({
    chain: {
      id: ARC_CHAIN_ID,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
  });
}

export async function fetchAccountPortfolio(markets: AppMarket[], accountAddress?: string | null): Promise<AccountPortfolioSnapshot> {
  const emptySnapshot = { positions: [], activity: [], previews: {} };

  if (!accountAddress || !isAddress(accountAddress)) {
    return emptySnapshot;
  }

  const client = createClient();
  if (!client) {
    return emptySnapshot;
  }

  const account = accountAddress as Address;
  const previews: Record<string, AccountMarketPreview> = {};
  const positions: Position[] = [];

  await Promise.all(markets.map(async (market) => {
    if (!isAddress(market.id)) return;

    const address = market.id as Address;
    const [yesShares, noShares, claimPreview, refundable, hasClaimed] = await Promise.all([
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [0, account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [1, account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewClaim', args: [account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewRefund', args: [account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'claimed', args: [account] }),
    ]);
    const claimable = claimPreview[0];

    previews[market.id] = {
      marketId: market.id,
      yesShares: formatShares(yesShares),
      noShares: formatShares(noShares),
      claimable: formatUsdc(claimable),
      refundable: formatUsdc(refundable),
      hasClaimed,
    };

    ([
      ['YES', yesShares],
      ['NO', noShares],
    ] as const).forEach(([outcome, shares]) => {
      if (shares === BigInt(0)) return;

      positions.push({
        marketId: market.id,
        title: market.title,
        outcome,
        shares: formatShares(shares),
        averagePrice: '$1.00',
        currentPrice: outcome === 'YES'
          ? `$${((market.outcomes.find((item) => item.label === 'YES')?.odds ?? 50) / 100).toFixed(2)}`
          : `$${((market.outcomes.find((item) => item.label === 'NO')?.odds ?? 50) / 100).toFixed(2)}`,
        value: formatUsdc(outcome === 'YES' ? (claimable || refundable || shares) : (refundable || shares)),
        status: getPositionStatus(market, claimable, refundable),
      });
    });
  }));

  const activity = await fetchRecentAccountActivity(client, markets, account);

  return { positions, activity, previews };
}

async function fetchRecentAccountActivity(
  client: ReturnType<typeof createPublicClient>,
  markets: AppMarket[],
  account: Address,
): Promise<PortfolioActivity[]> {
  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  const fromBlock = latestBlock > activityBlockWindow ? latestBlock - activityBlockWindow : BigInt(0);
  const rows = await Promise.all(markets.map(async (market) => {
    if (!isAddress(market.id)) return [];

    const address = market.id as Address;
    const [buys, claims, refunds] = await Promise.all([
      client.getLogs({ address, event: sharesBoughtEvent, args: { recipient: account }, fromBlock }).catch(() => []),
      client.getLogs({ address, event: claimedEvent, args: { user: account }, fromBlock }).catch(() => []),
      client.getLogs({ address, event: refundedEvent, args: { user: account }, fromBlock }).catch(() => []),
    ]);

    return [
      ...buys.map((log) => ({
        label: `Bought ${log.args.outcome === 0 ? 'YES' : 'NO'}`,
        market: market.title,
        detail: formatUsdc(log.args.amount ?? BigInt(0)),
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      })),
      ...claims.map((log) => ({
        label: 'Claimed payout',
        market: market.title,
        detail: `${formatUsdc(log.args.amount ?? BigInt(0))} payout`,
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      })),
      ...refunds.map((log) => ({
        label: 'Refunded collateral',
        market: market.title,
        detail: formatUsdc(log.args.amount ?? BigInt(0)),
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      })),
    ];
  }));

  return rows.flat().slice(-20).reverse();
}
