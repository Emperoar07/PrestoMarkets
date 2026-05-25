import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  type Address,
} from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { prestoMarketAbi, prestoMarketFactoryAbi } from './contracts';
import { fetchMarketCostBasisIndexed } from './costBasisIndexer';
import type { AppMarket } from './appState';
import type { PortfolioActivity, Position } from './portfolio';
// Arc's public RPC returns 413 on wide getLogs queries. Cap the activity window at ~1 hour
// of sub-second blocks (~7200 blocks at 0.5s) so each market's three log calls stay accepted.
const activityBlockWindow = BigInt(7_200);

export type AccountMarketPreview = {
  marketId: string;
  outcomeShares: Array<{ label: string; shares: string }>;
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

export type AccountPortfolioOptions = {
  includeActivity?: boolean;
};

const sharesBoughtEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const claimedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Claimed')!;
const refundedEvent = prestoMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;
const marketCreatedEvent = prestoMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;

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
  outcome: string;
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

  if (input.market.status === 'Closed') {
    return {
      value: costBasis,
      costBasis,
      valuationLabel: 'Awaiting resolution',
      pnl: 0,
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
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
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
): Promise<{ yes: number; no: number; byIndex: Record<number, number> }> {
  return fetchMarketCostBasisIndexed(client, marketAddress, account);
}

export async function fetchAccountPortfolio(
  markets: AppMarket[],
  accountAddress?: string | null,
  options: AccountPortfolioOptions = {},
): Promise<AccountPortfolioSnapshot> {
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
    const outcomeLabels = market.outcomes.length > 0 ? market.outcomes.map((outcome) => outcome.label) : ['YES', 'NO'];
    const [outcomeShareValues, claimPreview, refundable, hasClaimed, costBasis] = await Promise.all([
      Promise.all(outcomeLabels.map((_, outcomeIndex) =>
        client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [outcomeIndex, account] }).catch(() => BigInt(0)),
      )),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewClaim', args: [account] }).catch(() => [BigInt(0), BigInt(0)] as const),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewRefund', args: [account] }).catch(() => BigInt(0)),
      client.readContract({ address, abi: prestoMarketAbi, functionName: 'claimed', args: [account] }).catch(() => false),
      fetchMarketCostBasis(client, address, account).catch(() => ({ yes: 0, no: 0, byIndex: {} as Record<number, number> })),
    ]);
    const claimable = claimPreview[0];
    const yesIndex = outcomeLabels.findIndex((label) => label.toUpperCase() === 'YES');
    const noIndex = outcomeLabels.findIndex((label) => label.toUpperCase() === 'NO');
    const yesShares = outcomeShareValues[yesIndex >= 0 ? yesIndex : 0] ?? BigInt(0);
    const noShares = outcomeShareValues[noIndex >= 0 ? noIndex : 1] ?? BigInt(0);

    previews[market.id] = {
      marketId: market.id,
      outcomeShares: outcomeLabels.map((label, outcomeIndex) => ({
        label,
        shares: formatShares(outcomeShareValues[outcomeIndex] ?? BigInt(0)),
      })),
      yesShares: formatShares(yesShares),
      noShares: formatShares(noShares),
      claimable: formatUsdc(claimable),
      refundable: formatUsdc(refundable),
      hasClaimed,
    };

    outcomeLabels.forEach((outcome, outcomeIndex) => {
      const shares = outcomeShareValues[outcomeIndex] ?? BigInt(0);
      if (shares === BigInt(0)) return;
      const fallbackCostBasis = toUsdcNumber(shares);
      const outcomeCostBasis = costBasis.byIndex?.[outcomeIndex]
        ?? (outcome.toUpperCase() === 'YES'
          ? costBasis.yes
          : outcome.toUpperCase() === 'NO'
            ? costBasis.no
            : fallbackCostBasis);
      const valuation = getPositionValuation({
        market,
        outcome,
        shares,
        costBasis: outcomeCostBasis,
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
        currentPrice: `$${((market.outcomes.find((item) => item.label === outcome)?.odds ?? 50) / 100).toFixed(2)}`,
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

  const combined = options.includeActivity
    ? [
      ...(await fetchRecentCreatedMarkets(client, markets, account).catch(() => [] as PortfolioActivity[])),
      ...(await fetchRecentAccountActivity(client, markets, account)),
    ].sort((a, b) => b.time.localeCompare(a.time))
    : [];

  return { positions, activity: combined.slice(0, 24), previews };
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
        label: `Bought ${market.outcomes[Number(log.args.outcome)]?.label ?? `Outcome ${log.args.outcome}`}`,
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

async function fetchRecentCreatedMarkets(
  client: ReturnType<typeof createPublicClient>,
  markets: AppMarket[],
  account: Address,
): Promise<PortfolioActivity[]> {
  const config = getArcConfig();
  if (!config.factoryAddress || !isAddress(config.factoryAddress)) return [];

  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  const fromBlock = latestBlock > activityBlockWindow ? latestBlock - activityBlockWindow : BigInt(0);

  const logs = await client.getLogs({
    address: config.factoryAddress as Address,
    event: marketCreatedEvent,
    args: { creator: account },
    fromBlock,
  }).catch(() => []);

  const titleByAddress = new Map(markets.map((m) => [m.id.toLowerCase(), m.title]));

  return logs.map((log) => {
    const marketAddr = (log.args.market ?? '').toString();
    const title = titleByAddress.get(marketAddr.toLowerCase()) ?? `Market ${marketAddr.slice(0, 6)}…`;
    return {
      label: 'Created market',
      market: title,
      detail: `${marketAddr.slice(0, 6)}…${marketAddr.slice(-4)}`,
      status: 'Confirmed' as const,
      time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
      kind: 'create' as const,
      txHash: log.transactionHash ?? undefined,
    };
  });
}
