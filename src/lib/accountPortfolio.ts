import {
  createPublicClient,
  formatUnits,
  isAddress,
  type Address,
} from 'viem';
import { ARC_USDC_DECIMALS, createArcReadClient, withRpcRetry } from './arcClient';
import { getArcConfig } from './arcConfig';
import { prestoLmsrMarketAbi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { fetchMarketCostBasisIndexed } from './costBasisIndexer';
import type { AppMarket } from './appState';
import type { PortfolioActivity, Position } from './portfolio';
// Arc's public RPC returns 413 on wide getLogs queries. Cap the activity window at ~1 hour
// of sub-second blocks (~7200 blocks at 0.5s) so each market's three log calls stay accepted.
// ~24h of 0.5s Arc blocks. The old 7,200 (~1h) window made the Activity page look broken — buys
// older than an hour vanished ("Bought 0"). The wide range is safe because every getLogs here is
// address + topic + account filtered (tiny result sets), and a provider that rejects the range
// falls back to the old window instead of returning nothing.
const activityBlockWindow = BigInt(172_800);
const activityFallbackBlockWindow = BigInt(7_200);
const costBasisTimeoutMs = 2_000;

// account -> marketId -> last successful per-market portfolio result. Session-scoped: keeps the
// portfolio stable when a subset of per-market reads fails under RPC throttling (see below).
const lastGoodPortfolioByAccount = new Map<string, Map<string, { positions: Position[]; preview: AccountMarketPreview }>>();

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
// V3 LMSR markets emit different event signatures — see the activity API note; without these the
// portfolio feed misses every LMSR buy/sell/auto-payout/refund.
const lmsrSharesBoughtEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesBought')!;
const lmsrSharesSoldEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'SharesSold')!;
const lmsrWinnerPaidEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'WinnerPaid')!;
const lmsrRefundedEvent = prestoLmsrMarketAbi.find((e) => e.type === 'event' && e.name === 'Refunded')!;
const marketCreatedEvent = prestoMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;
const multiOutcomeMarketCreatedEvent = prestoMultiOutcomeMarketFactoryAbi.find((e) => e.type === 'event' && e.name === 'MarketCreated')!;

function formatUsdc(value: bigint) {
  return `$${Number(formatUnits(value, ARC_USDC_DECIMALS)).toFixed(2)}`;
}

function formatShares(value: bigint) {
  return Number(formatUnits(value, ARC_USDC_DECIMALS)).toFixed(2);
}

function toUsdcNumber(value: bigint) {
  return Number(formatUnits(value, ARC_USDC_DECIMALS));
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
  return createArcReadClient();
}

async function fetchMarketCostBasis(
  client: ReturnType<typeof createPublicClient>,
  marketAddress: Address,
  account: Address,
): Promise<{ yes: number; no: number; byIndex: Record<number, number> }> {
  return fetchMarketCostBasisIndexed(client, marketAddress, account);
}

function fallbackCostBasis() {
  return { yes: 0, no: 0, byIndex: {} as Record<number, number> };
}

async function withFallbackTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

  // Last-known-good per-market results. sharesOf reads used to fall back to 0 on RPC failure,
  // which silently DROPPED held positions — under provider throttling a varying subset of markets
  // failed each load, so the portfolio flickered between different counts and totals ($18 → $115 →
  // $62). Now a market whose share reads fail reuses its last successful result for this account
  // instead of pretending the user holds nothing.
  const accountKey = account.toLowerCase();
  const lastGood = lastGoodPortfolioByAccount.get(accountKey) ?? new Map<string, { positions: Position[]; preview: AccountMarketPreview }>();
  lastGoodPortfolioByAccount.set(accountKey, lastGood);

  // Markets this account has actually touched (holds shares, has something to claim/refund, or has
  // claimed before). The activity log scan below only covers these — scanning all ~200 markets x 3
  // event filters over the wide block window would be hundreds of pointless getLogs.
  const interactedMarketIds = new Set<string>();

  await Promise.all(markets.map(async (market) => {
    if (!isAddress(market.id)) return;

    const address = market.id as Address;
    const marketKey = market.id.toLowerCase();
    const outcomeLabels = market.outcomes.length > 0 ? market.outcomes.map((outcome) => outcome.label) : ['YES', 'NO'];
    // Core position data (sharesOf) is all-or-nothing per market: retry with 429-aware backoff,
    // and on persistent failure reuse the cached result rather than dropping the position.
    let outcomeShareValues: bigint[];
    try {
      outcomeShareValues = await Promise.all(outcomeLabels.map((_, outcomeIndex) =>
        withRpcRetry(() => client.readContract({ address, abi: prestoMarketAbi, functionName: 'sharesOf', args: [outcomeIndex, account] }) as Promise<bigint>),
      ));
    } catch {
      const cached = lastGood.get(marketKey);
      if (cached) {
        previews[market.id] = cached.preview;
        positions.push(...cached.positions);
      }
      return;
    }
    // Auxiliary reads keep individual fallbacks — previewClaim/refund/claimed legitimately revert
    // on contract versions that don't expose them, which must not disturb the position itself.
    // Skipped entirely for still-trading markets where this account holds nothing: an unsettled
    // market can't owe a claim or refund, and dropping those three calls for the ~200 untouched
    // markets removes most of the sync's RPC volume (the "Syncing..." slowness under throttling).
    const holdsShares = outcomeShareValues.some((shares) => shares > BigInt(0));
    const stillTrading = market.status === 'Open' || market.status === 'Closing soon';
    const [claimPreview, refundable, hasClaimed] = !holdsShares && stillTrading
      ? [[BigInt(0), BigInt(0)] as const, BigInt(0), false]
      : await Promise.all([
        withRpcRetry(() => client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewClaim', args: [account] })).catch(() => [BigInt(0), BigInt(0)] as const),
        withRpcRetry(() => client.readContract({ address, abi: prestoMarketAbi, functionName: 'previewRefund', args: [account] })).catch(() => BigInt(0)),
        withRpcRetry(() => client.readContract({ address, abi: prestoMarketAbi, functionName: 'claimed', args: [account] })).catch(() => false),
      ]);
    const claimable = claimPreview[0];
    if (outcomeShareValues.some((shares) => shares > BigInt(0)) || claimable > BigInt(0) || refundable > BigInt(0) || hasClaimed) {
      interactedMarketIds.add(market.id.toLowerCase());
    }
    const yesIndex = outcomeLabels.findIndex((label) => label.toUpperCase() === 'YES');
    const noIndex = outcomeLabels.findIndex((label) => label.toUpperCase() === 'NO');
    const yesShares = outcomeShareValues[yesIndex >= 0 ? yesIndex : 0] ?? BigInt(0);
    const noShares = outcomeShareValues[noIndex >= 0 ? noIndex : 1] ?? BigInt(0);
    const costBasis = holdsShares
      ? await withFallbackTimeout(
        fetchMarketCostBasis(client, address, account).catch(() => fallbackCostBasis()),
        costBasisTimeoutMs,
        fallbackCostBasis(),
      )
      : fallbackCostBasis();

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

    const marketPositions: Position[] = [];
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

      marketPositions.push({
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
    positions.push(...marketPositions);
    lastGood.set(marketKey, { positions: marketPositions, preview: previews[market.id] });
  }));

  const interactedMarkets = markets.filter((market) => interactedMarketIds.has(market.id.toLowerCase()));
  const combined = options.includeActivity
    ? [
      ...(await fetchRecentCreatedMarkets(client, markets, account).catch(() => [] as PortfolioActivity[])),
      ...(await fetchRecentAccountActivity(client, interactedMarkets, account)),
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

// getLogs with the wide window, retrying once on the small window when the provider rejects the
// range — so a strict provider degrades to the old behavior instead of an empty activity feed.
async function withWindowFallback<T>(
  latestBlock: bigint,
  run: (fromBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  const wideFrom = latestBlock > activityBlockWindow ? latestBlock - activityBlockWindow : BigInt(0);
  try {
    return await run(wideFrom);
  } catch {
    const narrowFrom = latestBlock > activityFallbackBlockWindow ? latestBlock - activityFallbackBlockWindow : BigInt(0);
    return run(narrowFrom).catch(() => [] as T[]);
  }
}

async function fetchRecentAccountActivity(
  client: ReturnType<typeof createPublicClient>,
  markets: AppMarket[],
  account: Address,
): Promise<PortfolioActivity[]> {
  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  const rows = await Promise.all(markets.map(async (market) => {
    if (!isAddress(market.id)) return [];

    const address = market.id as Address;
    // V2 and V3 markets emit different event signatures (different topic hashes); query the right
    // family per market so LMSR buys/sells/auto-payouts/refunds show up in the feed too.
    const none = Promise.resolve([] as never[]);
    const [buys, claims, refunds, lmsrBuys, lmsrSells, lmsrWins, lmsrRefunds] = await Promise.all([
      market.amm ? none : withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: sharesBoughtEvent, args: { recipient: account }, fromBlock })),
      market.amm ? none : withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: claimedEvent, args: { user: account }, fromBlock })),
      market.amm ? none : withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: refundedEvent, args: { user: account }, fromBlock })),
      market.amm ? withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: lmsrSharesBoughtEvent, args: { buyer: account }, fromBlock })) : none,
      market.amm ? withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: lmsrSharesSoldEvent, args: { seller: account }, fromBlock })) : none,
      market.amm ? withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: lmsrWinnerPaidEvent, args: { winner: account }, fromBlock })) : none,
      market.amm ? withWindowFallback(latestBlock, (fromBlock) => client.getLogs({ address, event: lmsrRefundedEvent, args: { holder: account }, fromBlock })) : none,
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
      ...lmsrBuys.map((log) => ({
        label: `Bought ${market.outcomes[Number((log.args as { outcome?: number | bigint }).outcome ?? 0)]?.label ?? 'outcome'}`,
        market: market.title,
        detail: formatUsdc((log.args as { cost6?: bigint }).cost6 ?? BigInt(0)),
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'out' as const,
        txHash: log.transactionHash ?? undefined,
      })),
      ...lmsrSells.map((log) => ({
        label: `Sold ${market.outcomes[Number((log.args as { outcome?: number | bigint }).outcome ?? 0)]?.label ?? 'shares'}`,
        market: market.title,
        detail: `${formatUsdc((log.args as { refund6?: bigint }).refund6 ?? BigInt(0))} received`,
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'in' as const,
        txHash: log.transactionHash ?? undefined,
      })),
      ...lmsrWins.map((log) => ({
        label: 'Won payout',
        market: market.title,
        detail: `${formatUsdc((log.args as { amount6?: bigint }).amount6 ?? BigInt(0))} payout`,
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'win' as const,
        txHash: log.transactionHash ?? undefined,
      })),
      ...lmsrRefunds.map((log) => ({
        label: 'Refunded collateral',
        market: market.title,
        detail: formatUsdc((log.args as { amount6?: bigint }).amount6 ?? BigInt(0)),
        status: 'Confirmed' as const,
        time: `Block ${log.blockNumber?.toString() ?? 'pending'}`,
        kind: 'refund' as const,
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
  const factories = [
    isAddress(config.factoryAddress) ? { address: config.factoryAddress as Address, multiOutcome: false } : null,
    isAddress(config.multiOutcomeFactoryAddress) ? { address: config.multiOutcomeFactoryAddress as Address, multiOutcome: true } : null,
    ...config.legacyFactoryAddresses.filter((address) => isAddress(address)).map((address) => ({ address: address as Address, multiOutcome: false })),
    ...config.legacyMultiOutcomeFactoryAddresses.filter((address) => isAddress(address)).map((address) => ({ address: address as Address, multiOutcome: true })),
  ].filter((factory): factory is { address: Address; multiOutcome: boolean } => factory !== null);
  if (factories.length === 0) return [];

  const latestBlock = await client.getBlockNumber().catch(() => BigInt(0));
  const fromBlock = latestBlock > activityBlockWindow ? latestBlock - activityBlockWindow : BigInt(0);

  const logs = (await Promise.all(factories.map((factory) => (
    factory.multiOutcome
      ? client.getLogs({
        address: factory.address,
        event: multiOutcomeMarketCreatedEvent,
        args: { creator: account },
        fromBlock,
      }).catch(() => [])
      : client.getLogs({
        address: factory.address,
        event: marketCreatedEvent,
        args: { creator: account },
        fromBlock,
      }).catch(() => [])
  )))).flat();

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
