import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  type Address,
} from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { prestoMarketAbi } from './contracts';
import { fetchMarketCostBasisIndexed } from './costBasisIndexer';
import type { AppMarket } from './appState';
import type { PortfolioActivity, Position } from './portfolio';
const activityBlockWindow = BigInt(2_592_000);

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

const sharesBoughtEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const claimedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Claimed')!;
const refundedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;

function formatUsdc(value: bigint) {
  return `$${Number(formatUnits(value, 6)).toFixed(2)}`;
}

function formatShares(value: bigint) {
  return Number(formatUnits(value, 6)).toFixed(2);
}

function toUsdcNumber(value: bigint) {
  return Number(formatUnits(value, 6));
}

function getPositionStatus(market: AppMarket, claimable: bigint, refundable: bigint, hasClaimed: boolean): Position['status'] {
  if (hasClaimed && (market.status === 'Resolved' || market.status === 'Canceled')) return 'Realized';
  if (claimable > BigInt(0) || refundable > BigInt(0)) return 'Claimable';
  if (market.status === 'Open' || market.status === 'Closing soon') return 'Open';
  return 'Watching';
}

function getPositionValuation(input: {
  market: AppMarket;
  outcome: 'YES' | 'NO';
  shares: bigint;
  costBasis: number;
  claimable: bigint;
  refundable: bigint;
  hasClaimed: boolean;
}) {
  const costBasis = input.costBasis;
  const outcomeOdds = (input.market.outcomes.find((item) => item.label === input.outcome)?.odds ?? 50) / 100;

  if (input.claimable > BigInt(0)) {
    const value = toUsdcNumber(input.claimable);
    return {
      value,
      costBasis,
      valuationLabel: input.hasClaimed ? 'Realized payout' : 'Claim preview',
      pnl: value - costBasis,
    };
  }

  if (input.refundable > BigInt(0)) {
    const value = toUsdcNumber(input.refundable);
    return {
      value,
      costBasis,
      valuationLabel: input.hasClaimed ? 'Realized refund' : 'Refund preview',
      pnl: value - costBasis,
    };
  }

  if (input.market.status === 'Open' || input.market.status === 'Closing soon') {
    const value = costBasis * outcomeOdds;
    return {
      value,
      costBasis,
      valuationLabel: 'Signal mark',
      pnl: value - costBasis,
    };
  }

  return {
    value: 0,
    costBasis,
    valuationLabel: 'Settled',
    pnl: -costBasis,
  };
}

function createClient() {
  const config = getArcConfig();

  if (!config.rpcUrl) {
    return null;
  }

  return createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
  });
}

async function fetchMarketCostBasis(
  client: ReturnType<typeof createPublicClient>,
  marketAddress: Address,
  account: Address,
): Promise<{ yes: number; no: number }> {
  return fetchMarketCostBasisIndexed(client, marketAddress, account);
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
    const [yesShares, noShares, claimPreview, refundable, hasClaimed, costBasis] = await Promise.all([
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [0, account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [1, account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewClaim', args: [account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewRefund', args: [account] }),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'claimed', args: [account] }),
      fetchMarketCostBasis(client, address, account),
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
      const valuation = getPositionValuation({
        market,
        outcome,
        shares,
        costBasis: outcome === 'YES' ? costBasis.yes : costBasis.no,
        claimable: market.winningOutcomeLabel === outcome ? claimable : BigInt(0),
        refundable: market.status === 'Canceled' ? shares : BigInt(0),
        hasClaimed,
      });

      positions.push({
        marketId: market.id,
        title: market.title,
        outcome,
        shares: formatShares(shares),
        averagePrice: '$1.00',
        currentPrice: outcome === 'YES'
          ? `$${((market.outcomes.find((item) => item.label === 'YES')?.odds ?? 50) / 100).toFixed(2)}`
          : `$${((market.outcomes.find((item) => item.label === 'NO')?.odds ?? 50) / 100).toFixed(2)}`,
        value: formatUsdNumber(valuation.value),
        costBasis: formatUsdNumber(valuation.costBasis),
        pnl: formatSignedUsd(valuation.pnl),
        valuationLabel: valuation.valuationLabel,
        status: getPositionStatus(
          market,
          market.winningOutcomeLabel === outcome ? claimable : BigInt(0),
          market.status === 'Canceled' ? shares : BigInt(0),
          hasClaimed,
        ),
      });
    });
  }));

  const activity = await fetchRecentAccountActivity(client, markets, account);

  return { positions, activity, previews };
}

function formatUsdNumber(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatSignedUsd(value: number) {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}$${value.toFixed(2)}`;
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
        kind: 'out' as const,
        txHash: log.transactionHash ?? undefined,
      })),
      ...claims.map((log) => ({
        label: 'Won payout',
        market: market.title,
        detail: `${formatUsdc(log.args.amount ?? BigInt(0))} payout`,
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'win' as const,
        txHash: log.transactionHash ?? undefined,
      })),
      ...refunds.map((log) => ({
        label: 'Refunded collateral',
        market: market.title,
        detail: formatUsdc(log.args.amount ?? BigInt(0)),
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'refund' as const,
        txHash: log.transactionHash ?? undefined,
      })),
    ];
  }));

  return rows.flat().slice(-20).reverse();
}
