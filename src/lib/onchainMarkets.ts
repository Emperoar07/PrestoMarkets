import { createPublicClient, fallback, formatUnits, http, isAddress, type Address } from 'viem';
import { getArcConfig, getArcChainId, collateralSymbolForAddress } from './arcConfig';
import { createArcChain, arcShouldThrow } from './arcClient';
import { erc20Abi, prestoLmsrMarketAbi, prestoLmsrMarketFactoryAbi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { isSafeResolutionUri, parseMarketMetadata } from './marketMetadata';
import { stripSourceFromDescription } from './sourcePrivacy';
import { normalizeOutcomeOdds } from './marketUtils';
import type { AppMarket } from './appState';
import type { MarketStatus, MarketType, ResolutionMode } from './markets';
import { getDb, hasDatabaseUrl } from './db/client';
import { marketMetadataOverrides, marketListCache, marketFlags } from './db/schema';
import { eq } from 'drizzle-orm';
import { hasGoodImage } from './imageQuality';
import { logger } from './logger';
const MARKET_ADDRESS_BATCH_SIZE = 50;
const MARKET_HYDRATION_BATCH_SIZE = 32; // Increased from 8 for faster parallel hydration
const MAX_MARKETS = 500;
const MARKET_CACHE_TTL_MS = 60_000; // Increased from 8s to 60s to reduce unnecessary refetches
let marketCache: { at: number; markets: AppMarket[] } | null = null;
let marketFetchInFlight: Promise<AppMarket[]> | null = null;

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise<void>((resolve) => { setTimeout(resolve, 500 * (attempt + 1)); });
    }
  }
  throw new Error('unreachable');
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// The platform's trusted oracle address. A market is "verified" only when its on-chain
// resolver equals this — the displayed resolutionMode comes from metadata and is forgeable,
// so address identity is the only trustworthy signal of who can settle the pool.
const TRUSTED_RESOLVER = (process.env.NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS ?? '').trim().toLowerCase();

function isVerifiedResolver(resolver: string): boolean {
  return TRUSTED_RESOLVER.length > 0 && resolver.toLowerCase() === TRUSTED_RESOLVER;
}

function getMarketType(kind: number): MarketType {
  if (kind === 1) return 'Opinion';
  if (kind === 2) return 'Opinion';
  return 'Prediction';
}

function getResolutionMode(kind: number): ResolutionMode {
  if (kind === 1) return 'Community resolver';
  if (kind === 2) return 'Agent assisted';
  return 'Human resolver';
}

// Show 'Closing soon' only when the close is within 5 hours, so the badge actually means
// imminent close and not 'this week sometime'.
const CLOSING_SOON_MS = 5 * 3_600_000;

function getStatus(state: number, closeTime: bigint): MarketStatus {
  if (state === 1) return 'Resolved';
  if (state === 2) return 'Canceled';

  const closeMs = Number(closeTime) * 1000;
  const diff = closeMs - Date.now();

  if (diff <= 0) return 'Closed';
  if (diff <= CLOSING_SOON_MS) return 'Closing soon';
  return 'Open';
}

function getCloseLabel(status: MarketStatus, closeTime: bigint) {
  if (status === 'Resolved' || status === 'Canceled' || status === 'Closed') return status;

  const diff = Number(closeTime) * 1000 - Date.now();

  if (diff <= 0) return 'Closed';

  const days = Math.ceil(diff / 86_400_000);
  if (days < 1) {
    const hours = Math.max(1, Math.ceil(diff / 3_600_000));
    return `${hours} hr${hours === 1 ? '' : 's'}`;
  }

  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatOnchainUsd(value: bigint) {
  const amount = Number(formatUnits(value, 6));

  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  if (amount > 0 && amount < 0.01) return '<$0.01';
  if (amount > 0 && amount < 1) return `$${amount.toFixed(2)}`;

  return `$${amount.toFixed(0)}`;
}

function getOutcomeOdds(shares: bigint[]) {
  const total = shares.reduce((sum, item) => sum + item, BigInt(0));
  if (total === BigInt(0)) return normalizeOutcomeOdds(shares.map(() => 0));
  const totalUsdc = Number(formatUnits(total, 6));
  return normalizeOutcomeOdds(shares.map((item) => (Number(formatUnits(item, 6)) / totalUsdc) * 100));
}

// LMSR price(i) is WAD (1e18 == 100%). Convert to percent and renormalize so the displayed
// odds sum cleanly to 100 despite per-outcome rounding.
export function getLmsrOdds(prices: bigint[]) {
  return normalizeOutcomeOdds(prices.map((p) => Number(p) / 1e16));
}

// V3 State enum is { Open:0, Proposed:1, Disputed:2, Resolved:3, Canceled:4 } — different from V1/V2
// (where 1==Resolved, 2==Canceled), so LMSR markets need their own status mapping.
function getLmsrStatus(state: number, closeTime: bigint): MarketStatus {
  if (state === 3) return 'Resolved';
  if (state === 4) return 'Canceled';
  if (state === 1 || state === 2) return 'Closed'; // proposed/disputed — closed, awaiting settlement
  return getStatus(0, closeTime); // Open: fall back to the time-based Open/Closing soon/Closed logic
}

type MarketCreationInfo = {
  createdAt?: string;
  sortKey: number;
};

async function readMarket(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  index: number,
  creationInfo?: MarketCreationInfo,
): Promise<AppMarket> {
  const [
    creator,
    resolver,
    closeTime,
    protocolFeeBps,
    marketKind,
    metadataURI,
    state,
    winningOutcome,
    totalCollateral,
    resolvedCollateral,
    resolutionURI,
    collateralToken,
  ] = await Promise.all([
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'creator' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'resolver' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'closeTime' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'protocolFeeBps' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'marketKind' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'metadataURI' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'state' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'winningOutcome' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'totalCollateral' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'resolvedCollateral' }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'resolutionURI' }),
    // V2 markets expose collateral(); older markets without it fall back to USDC.
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'collateral' }).catch(() => null),
  ]);

  // Optimistic-resolution proposal state — V2 contracts only; V1 markets revert, so every read
  // falls back to null and the market simply carries no proposal.
  const [proposalProposer, proposedOutcomeRaw, proposalTimeRaw, proposalDisputed, proposalURI] = await Promise.all([
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'proposalProposer' }).catch(() => null),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'proposedOutcome' }).catch(() => null),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'proposalTime' }).catch(() => null),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'proposalDisputed' }).catch(() => null),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'proposalURI' }).catch(() => null),
  ]);

  const metadata = parseMarketMetadata(metadataURI);
  const outcomeLabels = metadata?.outcomeOptions && metadata.outcomeOptions.length >= 2
    ? metadata.outcomeOptions
    : ['YES', 'NO'];
  const outcomeCount = await client
    .readContract({ address, abi: prestoMarketAbi, functionName: 'outcomeCount' })
    .then((value) => Number(value))
    .catch(() => outcomeLabels.length > 2 ? outcomeLabels.length : 2);
  const cappedOutcomeCount = Math.max(2, Math.min(outcomeCount, 12));
  const labels = Array.from({ length: cappedOutcomeCount }, (_, i) => outcomeLabels[i] ?? `Outcome ${i + 1}`);
  const shares = await Promise.all(
    labels.map((_, outcomeIndex) => client.readContract({
      address,
      abi: prestoMarketAbi,
      functionName: 'totalShares',
      args: [outcomeIndex],
    })),
  );

  const kind = Number(marketKind);
  const status = getStatus(Number(state), closeTime);
  const odds = getOutcomeOdds(shares);
  const marketType = getMarketType(kind);
  const collateralValue = status === 'Resolved' ? resolvedCollateral : totalCollateral;
  const titleSource = metadataURI.trim().length > 0 ? metadataURI : `Market ${index + 1}`;
  const winningLabel = labels[Number(winningOutcome)] ?? `Outcome ${Number(winningOutcome) + 1}`;

  const rawDescription = metadata?.description || `Onchain ${marketType.toLowerCase()} market created from metadata ${titleSource}.`;

  return {
    id: address.toLowerCase(),
    type: marketType,
    title: metadata?.name || `Arc market ${index + 1}`,
    description: stripSourceFromDescription(rawDescription),
    imageURI: metadata?.imageURI || metadata?.image,
    pollOptions: labels.length > 2 ? labels : metadata?.outcomeOptions,
    category: metadata?.categories?.[0] || metadata?.category || 'Onchain',
    categories: metadata?.categories && metadata.categories.length > 0
      ? metadata.categories
      : (metadata?.category ? [metadata.category] : undefined),
    volume: formatOnchainUsd(totalCollateral),
    liquidity: formatOnchainUsd(collateralValue),
    closeLabel: getCloseLabel(status, closeTime),
    status,
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: truncateAddress(resolver),
    resolverAddress: resolver,
    resolverVerified: isVerifiedResolver(resolver),
    resolutionMode: metadata?.resolutionMode || getResolutionMode(kind),
    sourceOfTruth: metadata?.sourceOfTruth || metadataURI || 'Metadata URI was not set at creation.',
    rulesSchema: metadata?.rulesSchema ? {
      ...metadata.rulesSchema,
      settlementAsset: 'USDC',
    } : {
      type: marketType,
      outcomes: labels,
      sourceOfTruth: metadata?.sourceOfTruth || metadataURI || 'Metadata URI was not set at creation.',
      resolverMode: metadata?.resolutionMode || getResolutionMode(kind),
      closeRule: 'Market closes at the onchain closeTime. Resolver settles against the written rules and source of truth.',
      settlementAsset: 'USDC',
    },
    rules: (() => {
      const baseRules = metadata?.rules || 'Rules live in the market metadata URI. Resolver evidence is published after settlement.';
      if (status === 'Resolved') {
        return `${baseRules}\n\nThis market has been resolved. Winning outcome: ${winningLabel}.`;
      }
      if (status === 'Canceled') {
        return `${baseRules}\n\nThis market has been canceled and all trades have been refunded.`;
      }
      return baseRules;
    })(),
    winningOutcomeLabel: status === 'Resolved' ? winningLabel : undefined,
    resolutionURI: isSafeResolutionUri(resolutionURI) ? resolutionURI : undefined,
    collateralAddress: typeof collateralToken === 'string' ? collateralToken : undefined,
    collateralSymbol: collateralSymbolForAddress(typeof collateralToken === 'string' ? collateralToken : undefined),
    proposal: typeof proposalProposer === 'string' && proposalProposer !== '0x0000000000000000000000000000000000000000' && status !== 'Resolved' && status !== 'Canceled'
      ? {
          outcome: Number(proposedOutcomeRaw ?? 0),
          outcomeLabel: labels[Number(proposedOutcomeRaw ?? 0)] ?? `Outcome ${Number(proposedOutcomeRaw ?? 0) + 1}`,
          proposer: proposalProposer,
          proposedAtMs: Number(proposalTimeRaw ?? 0) * 1000,
          disputed: Boolean(proposalDisputed),
          evidenceURI: typeof proposalURI === 'string' && isSafeResolutionUri(proposalURI) ? proposalURI : undefined,
        }
      : undefined,
    createdBy: truncateAddress(creator),
    createdByType: metadata?.createdByType,
    displayType: metadata?.displayType,
    creatorAddress: creator,
    agentName: metadata?.agentName,
    agentSource: metadata?.agentSource,
    agentModel: metadata?.agentModel,
    agentReason: metadata?.agentReason,
    agentConfidence: metadata?.agentConfidence,
    trendSource: metadata?.trendSource,
    trendUrl: metadata?.trendUrl,
    momentumScore: metadata?.momentumScore,
    safetyScore: metadata?.safetyScore,
    kickoffTime: metadata?.kickoffTime,
    feeMode: Number(protocolFeeBps) > 0 ? `${protocolFeeBps} bps protocol fee` : 'No protocol fee',
    outcomes: labels.map((label, outcomeIndex) => ({
      label,
      odds: odds[outcomeIndex] ?? 0,
      liquidity: formatOnchainUsd(shares[outcomeIndex] ?? BigInt(0)),
      image: metadata?.outcomeImages?.[outcomeIndex] || undefined,
    })) as AppMarket['outcomes'],
    activity: [
      ...labels.slice(0, 4).map((label, outcomeIndex) => ({
        label: `${label} shares`,
        value: formatOnchainUsd(shares[outcomeIndex] ?? BigInt(0)),
      })),
      { label: 'Collateral', value: formatOnchainUsd(totalCollateral) },
    ],
    source: 'onchain',
    closeDate: new Date(Number(closeTime) * 1000).toISOString(),
    createdAt: metadata?.createdAt ?? creationInfo?.createdAt ?? '',
    createdSortKey: creationInfo?.sortKey ?? index,
  };
}

// V3 LMSR markets expose a different surface than V1/V2 (live price(i), feeBps, a 5-state enum,
// no totalCollateral). Read them on their own path so the V1/V2 reader stays untouched, then shape
// the same AppMarket so every consumer (cards, detail, agent) is collateral- and version-agnostic.
async function readLmsrMarket(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
  index: number,
  creationInfo?: MarketCreationInfo,
): Promise<AppMarket> {
  const [creator, resolver, closeTime, marketKind, metadataURI, state, outcomeCountRaw, feeBps, winningOutcome, collateralToken, pausedRaw] =
    await Promise.all([
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'creator' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'resolver' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'closeTime' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'marketKind' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'metadataURI' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'state' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'outcomeCount' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'feeBps' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'winningOutcome' }),
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'collateral' }),
      // Guardian pause — buys/sells revert while true, so the UI must show the freeze.
      client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'paused' }).catch(() => false),
    ]);

  const metadata = parseMarketMetadata(metadataURI as string);
  const outcomeLabels = metadata?.outcomeOptions && metadata.outcomeOptions.length >= 2 ? metadata.outcomeOptions : ['YES', 'NO'];
  const cappedOutcomeCount = Math.max(2, Math.min(Number(outcomeCountRaw), 12));
  const labels = Array.from({ length: cappedOutcomeCount }, (_, i) => outcomeLabels[i] ?? `Outcome ${i + 1}`);

  // Live LMSR prices = the market's current odds. Pool collateral balance is the liquidity figure.
  const [prices, poolBalance, proposer, proposedOutcomeRaw, challengeEndsAtRaw] = await Promise.all([
    Promise.all(labels.map((_, i) => client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'price', args: [i] }))),
    client.readContract({ address: collateralToken as Address, abi: erc20Abi, functionName: 'balanceOf', args: [address] }).catch(() => BigInt(0)),
    client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'proposer' }).catch(() => null),
    client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'proposedOutcome' }).catch(() => null),
    client.readContract({ address, abi: prestoLmsrMarketAbi, functionName: 'proposalChallengeEndsAt' }).catch(() => null),
  ]);

  const kind = Number(marketKind);
  const stateNum = Number(state);
  const status = getLmsrStatus(stateNum, closeTime as bigint);
  const odds = getLmsrOdds(prices as bigint[]);
  const marketType = getMarketType(kind);
  const titleSource = (metadataURI as string).trim().length > 0 ? (metadataURI as string) : `Market ${index + 1}`;
  const winningLabel = labels[Number(winningOutcome)] ?? `Outcome ${Number(winningOutcome) + 1}`;
  const poolValue = poolBalance as bigint;
  const rawDescription = metadata?.description || `Onchain ${marketType.toLowerCase()} market created from metadata ${titleSource}.`;
  const collateralSymbol = collateralSymbolForAddress(typeof collateralToken === 'string' ? collateralToken : undefined);

  const isProposalLive = typeof proposer === 'string'
    && proposer !== '0x0000000000000000000000000000000000000000'
    && (stateNum === 1 || stateNum === 2);

  return {
    id: address.toLowerCase(),
    type: marketType,
    title: metadata?.name || `Arc market ${index + 1}`,
    description: stripSourceFromDescription(rawDescription),
    imageURI: metadata?.imageURI || metadata?.image,
    pollOptions: labels.length > 2 ? labels : metadata?.outcomeOptions,
    category: metadata?.categories?.[0] || metadata?.category || 'Onchain',
    categories: metadata?.categories && metadata.categories.length > 0
      ? metadata.categories
      : (metadata?.category ? [metadata.category] : undefined),
    volume: formatOnchainUsd(poolValue),
    liquidity: formatOnchainUsd(poolValue),
    closeLabel: getCloseLabel(status, closeTime as bigint),
    status,
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: truncateAddress(resolver as string),
    resolverAddress: resolver as string,
    resolverVerified: isVerifiedResolver(resolver as string),
    resolutionMode: metadata?.resolutionMode || getResolutionMode(kind),
    sourceOfTruth: metadata?.sourceOfTruth || (metadataURI as string) || 'Metadata URI was not set at creation.',
    rulesSchema: metadata?.rulesSchema ? {
      ...metadata.rulesSchema,
      settlementAsset: 'USDC',
    } : {
      type: marketType,
      outcomes: labels,
      sourceOfTruth: metadata?.sourceOfTruth || (metadataURI as string) || 'Metadata URI was not set at creation.',
      resolverMode: metadata?.resolutionMode || getResolutionMode(kind),
      closeRule: 'Market closes at the onchain closeTime. Resolver proposes a result, then a 30-minute challenge window before settlement.',
      settlementAsset: 'USDC',
    },
    rules: (() => {
      const baseRules = metadata?.rules || 'Rules live in the market metadata URI. Resolver evidence is published after settlement.';
      if (status === 'Resolved') return `${baseRules}\n\nThis market has been resolved. Winning outcome: ${winningLabel}.`;
      if (status === 'Canceled') return `${baseRules}\n\nThis market has been canceled and all positions can be refunded at their LMSR value.`;
      return baseRules;
    })(),
    winningOutcomeLabel: status === 'Resolved' ? winningLabel : undefined,
    collateralAddress: typeof collateralToken === 'string' ? collateralToken : undefined,
    collateralSymbol,
    amm: true,
    paused: Boolean(pausedRaw),
    proposal: isProposalLive
      ? {
          outcome: Number(proposedOutcomeRaw ?? 0),
          outcomeLabel: labels[Number(proposedOutcomeRaw ?? 0)] ?? `Outcome ${Number(proposedOutcomeRaw ?? 0) + 1}`,
          proposer: proposer as string,
          proposedAtMs: challengeEndsAtRaw != null ? (Number(challengeEndsAtRaw) - 30 * 60) * 1000 : 0,
          disputed: stateNum === 2,
          evidenceURI: undefined,
        }
      : undefined,
    createdBy: truncateAddress(creator as string),
    createdByType: metadata?.createdByType,
    displayType: metadata?.displayType,
    creatorAddress: creator as string,
    agentName: metadata?.agentName,
    agentSource: metadata?.agentSource,
    agentModel: metadata?.agentModel,
    agentReason: metadata?.agentReason,
    agentConfidence: metadata?.agentConfidence,
    trendSource: metadata?.trendSource,
    trendUrl: metadata?.trendUrl,
    momentumScore: metadata?.momentumScore,
    safetyScore: metadata?.safetyScore,
    kickoffTime: metadata?.kickoffTime,
    feeMode: Number(feeBps) > 0 ? `${feeBps} bps trading fee` : 'No trading fee',
    outcomes: labels.map((label, outcomeIndex) => ({
      label,
      odds: odds[outcomeIndex] ?? 0,
      liquidity: formatOnchainUsd(poolValue),
      image: metadata?.outcomeImages?.[outcomeIndex] || undefined,
    })) as AppMarket['outcomes'],
    activity: [
      ...labels.slice(0, 4).map((label, outcomeIndex) => ({
        label: `${label} price`,
        value: `${(odds[outcomeIndex] ?? 0).toFixed(0)}%`,
      })),
      { label: 'Liquidity', value: formatOnchainUsd(poolValue) },
    ],
    source: 'onchain',
    closeDate: new Date(Number(closeTime) * 1000).toISOString(),
    createdAt: metadata?.createdAt ?? creationInfo?.createdAt ?? '',
    createdSortKey: creationInfo?.sortKey ?? index,
  };
}

async function readCreationInfo(
  client: ReturnType<typeof createPublicClient>,
  factories: { address: Address; abi: typeof prestoMarketFactoryAbi | typeof prestoMultiOutcomeMarketFactoryAbi | typeof prestoLmsrMarketFactoryAbi; lmsr?: boolean }[],
  fallbackOrder: Map<string, number>,
): Promise<Map<string, MarketCreationInfo>> {
  const entries = new Map<string, { blockNumber: bigint; logIndex: number; sortKey: number }>();

  try {
    for (const factory of factories) {
      const logs = await withRetry(() => client.getContractEvents({
        address: factory.address,
        abi: factory.abi,
        eventName: 'MarketCreated',
        fromBlock: BigInt(0),
        toBlock: 'latest',
      }));

      for (const log of logs) {
        const marketArg = log.args.market;
        const market = typeof marketArg === 'string' ? marketArg.toLowerCase() : undefined;
        if (!market || !log.blockNumber) continue;
        const logIndex = Number(log.logIndex ?? 0);
        entries.set(market, {
          blockNumber: log.blockNumber,
          logIndex,
          sortKey: Number(log.blockNumber) * 1_000_000 + logIndex,
        });
      }
    }
  } catch {
    return new Map(Array.from(fallbackOrder.entries()).map(([address, sortKey]) => [address, { sortKey }]));
  }

  const blocks = new Map<string, string>();
  await Promise.all(Array.from(new Set(Array.from(entries.values()).map((entry) => entry.blockNumber.toString())))
    .map(async (blockNumber) => {
      try {
        const block = await withRetry(() => client.getBlock({ blockNumber: BigInt(blockNumber) }));
        blocks.set(blockNumber, new Date(Number(block.timestamp) * 1000).toISOString());
      } catch {
        blocks.set(blockNumber, '');
      }
    }));

  return new Map(Array.from(fallbackOrder.entries()).map(([address, fallbackSortKey]) => {
    const entry = entries.get(address);
    if (!entry) return [address, { sortKey: fallbackSortKey }];
    return [address, {
      sortKey: entry.sortKey,
      createdAt: blocks.get(entry.blockNumber.toString()) || undefined,
    }];
  }));
}

async function readOnchainMarkets() {
  const config = getArcConfig();

  if (!config.rpcUrl || (!config.factoryAddress && !config.multiOutcomeFactoryAddress)) {
    return [];
  }

  const chainId = getArcChainId();
  const client = createPublicClient({
    chain: {
      ...createArcChain(config.rpcUrls),
      id: chainId,
    },
    // Per-endpoint timeout so a hung/slow provider fails over fast instead of stalling the whole
    // grid read on viem's 10s default. 7s comfortably covers a healthy batched multicall request
    // (each batch request returns in a few seconds) while abandoning a leg that isn't keeping up.
    // arcShouldThrow makes failover advance past rate-limit/daily-quota errors (which viem otherwise
    // maps to -32003 and refuses to fail over on) so a throttled provider can't strand the read.
    transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 7_000 })), { rank: false, shouldThrow: arcShouldThrow }),
    batch: {
      multicall: {
        batchSize: 16_384,
        wait: 10,
      },
    },
  });

  const factories = [
    config.factoryAddress ? { address: config.factoryAddress as Address, abi: prestoMarketFactoryAbi } : null,
    config.multiOutcomeFactoryAddress ? { address: config.multiOutcomeFactoryAddress as Address, abi: prestoMultiOutcomeMarketFactoryAbi } : null,
    // EURC-collateral factories — euro markets read alongside USDC ones (collateral() tags each).
    config.eurcFactoryAddress ? { address: config.eurcFactoryAddress as Address, abi: prestoMarketFactoryAbi } : null,
    config.eurcMultiOutcomeFactoryAddress ? { address: config.eurcMultiOutcomeFactoryAddress as Address, abi: prestoMultiOutcomeMarketFactoryAbi } : null,
    // V3 LMSR factories (USDC + EURC). Their markets read on the LMSR path (live price as odds).
    config.lmsrFactoryAddress && isAddress(config.lmsrFactoryAddress) ? { address: config.lmsrFactoryAddress as Address, abi: prestoLmsrMarketFactoryAbi, lmsr: true } : null,
    config.eurcLmsrFactoryAddress && isAddress(config.eurcLmsrFactoryAddress) ? { address: config.eurcLmsrFactoryAddress as Address, abi: prestoLmsrMarketFactoryAbi, lmsr: true } : null,
    // Retired factories: their markets stay readable so positions and claims never disappear.
    ...config.legacyFactoryAddresses.map((address) => ({ address: address as Address, abi: prestoMarketFactoryAbi })),
    ...config.legacyMultiOutcomeFactoryAddresses.map((address) => ({ address: address as Address, abi: prestoMultiOutcomeMarketFactoryAbi })),
  ].filter(Boolean) as { address: Address; abi: typeof prestoMarketFactoryAbi | typeof prestoMultiOutcomeMarketFactoryAbi | typeof prestoLmsrMarketFactoryAbi; lmsr?: boolean }[];
  const marketAddresses: Address[] = [];
  const lmsrMarkets = new Set<string>();
  const fallbackOrder = new Map<string, number>();

  for (const factory of factories) {
    const marketCount = await withRetry(() => client.readContract({
      address: factory.address,
      abi: factory.abi,
      functionName: 'marketCount',
    }));

    const count = Math.min(Number(marketCount), MAX_MARKETS);
    const indices = Array.from({ length: count }, (_, i) => i);

    for (let i = 0; i < indices.length; i += MARKET_ADDRESS_BATCH_SIZE) {
      const batch = indices.slice(i, i + MARKET_ADDRESS_BATCH_SIZE);
      const batchAddresses = await Promise.all(
        batch.map((index) => withRetry(() => client.readContract({
          address: factory.address,
          abi: factory.abi,
          functionName: 'markets',
          args: [BigInt(index)],
        }))),
      );
      marketAddresses.push(...batchAddresses);
      for (const address of batchAddresses) {
        fallbackOrder.set(address.toLowerCase(), fallbackOrder.size + 1);
        if (factory.lmsr) lmsrMarkets.add(address.toLowerCase());
      }
    }
  }

  const creationInfo = await readCreationInfo(client, factories, fallbackOrder);

  const markets: AppMarket[] = [];
  for (let i = 0; i < marketAddresses.length; i += MARKET_HYDRATION_BATCH_SIZE) {
    const batch = marketAddresses.slice(i, i + MARKET_HYDRATION_BATCH_SIZE);
    const batchMarkets = await Promise.all(
      batch.map((address, batchIndex) => withRetry(() => (lmsrMarkets.has(address.toLowerCase()) ? readLmsrMarket : readMarket)(
        client,
        address,
        i + batchIndex,
        creationInfo.get(address.toLowerCase()),
      ))),
    );
    markets.push(...batchMarkets);
  }

  // Apply metadata overrides (updated market images) here, at the single cached source, so every
  // consumer gets merged markets and cards never flip between tile and image across renders.
  await applyImageOverrides(markets);
  await applyMarketFlags(markets);

  return markets;
}

// Merge app-level flags (currently 'frozen') into the market list. Server-only best-effort read —
// the browser's direct-read fallback skips it, but every served list (API + snapshot) includes it.
async function applyMarketFlags(markets: AppMarket[]) {
  if (typeof window !== 'undefined' || !hasDatabaseUrl()) return;
  try {
    const rows = await getDb().select().from(marketFlags);
    if (rows.length === 0) return;
    const frozen = new Set(rows.filter((r) => r.flag === 'frozen').map((r) => r.marketId.toLowerCase()));
    for (const m of markets) {
      if (frozen.has(m.id.toLowerCase())) m.frozen = true;
    }
  } catch (err) {
    logger.warn('onchain-markets', 'market flags merge failed', { error: String(err) });
  }
}

// Merge stored image overrides into the given markets. Server reads the DB directly; the browser
// fetches the public override map. Shared by the full read and the single-market refresh.
async function applyImageOverrides(markets: AppMarket[]) {
  try {
    let overridesMap = new Map<string, string>();
    if (hasDatabaseUrl()) {
      const overrides = await getDb().select().from(marketMetadataOverrides);
      overridesMap = new Map(overrides.map((row) => [row.marketId.toLowerCase(), row.imageUri]));
    } else if (typeof window !== 'undefined') {
      const res = await fetch('/api/market-images', { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
      if (res.ok) {
        const data = (await res.json().catch(() => ({ images: {} }))) as { images?: Record<string, string> };
        overridesMap = new Map(Object.entries(data.images ?? {}));
      }
    }
    for (const m of markets) {
      const overrideImage = overridesMap.get(m.id.toLowerCase());
      if (!overrideImage) continue;
      // Prefer a stored override whenever the on-chain image isn't render-reliable — empty, a branded
      // SVG fallback, OR a broken/untrusted HTTP URL that loads as a blank letter tile. This is the
      // same quality bar the backfill uses, so a backfilled image always wins over a bad on-chain one.
      //
      // ALSO: any REAL override (a data-image payload OR a probed URL — anything but the branded
      // SVG banner) wins over an on-chain http URL, even a "good" trusted-host one. hasGoodImage
      // trusts by HOSTNAME, so a dead trusted URL (Wikimedia 400s) passes it and rendered as a
      // letter tile forever while the working replacement sat unused in the override store. The
      // backfill only writes an override when the market's own image was missing/dead, and it
      // liveness-probes URL candidates before storing — so the override is always the safer pick.
      const overrideIsReal = !overrideImage.startsWith('data:image/svg');
      if (!hasGoodImage(m.imageURI) || (overrideIsReal && !m.imageURI?.startsWith('data:'))) {
        m.imageURI = overrideImage;
      }
    }
  } catch (err) {
    logger.warn('onchain-markets', 'Failed to load metadata overrides', { error: String(err) });
  }
}

// Re-read a SINGLE market straight from chain — the targeted post-trade refresh. Reading one market
// is sub-second versus the ~13s full-grid read, so after a buy/sell we patch just the traded market
// for instant feedback and let the full refresh catch positions/portfolio in the background.
export async function fetchOnchainMarket(
  address: string,
  opts: { isAmm?: boolean; index?: number } = {},
): Promise<AppMarket | null> {
  const config = getArcConfig();
  if (!config.rpcUrl || !isAddress(address)) return null;
  const chainId = getArcChainId();
  const client = createPublicClient({
    chain: { ...createArcChain(config.rpcUrls), id: chainId },
    // Per-endpoint timeout so a hung/slow provider fails over fast instead of stalling the whole
    // grid read on viem's 10s default. 7s comfortably covers a healthy batched multicall request
    // (each batch request returns in a few seconds) while abandoning a leg that isn't keeping up.
    // arcShouldThrow makes failover advance past rate-limit/daily-quota errors (which viem otherwise
    // maps to -32003 and refuses to fail over on) so a throttled provider can't strand the read.
    transport: fallback(config.rpcUrls.map((url) => http(url, { timeout: 7_000 })), { rank: false, shouldThrow: arcShouldThrow }),
    batch: { multicall: { batchSize: 16_384, wait: 10 } },
  });
  try {
    const reader = opts.isAmm ? readLmsrMarket : readMarket;
    const market = await withRetry(() => reader(client, address as Address, opts.index ?? 0));
    await applyImageOverrides([market]);
    return market;
  } catch (err) {
    logger.warn('onchain-markets', 'single-market read failed', { address, error: String(err) });
    return null;
  }
}

export async function fetchOnchainMarkets(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && marketCache && now - marketCache.at < MARKET_CACHE_TTL_MS) {
    return marketCache.markets;
  }

  if (!options.force && marketFetchInFlight) {
    return marketFetchInFlight;
  }

  marketFetchInFlight = readOnchainMarkets()
    .then((markets) => {
      marketCache = { at: Date.now(), markets };
      // Persist the snapshot so COLD serverless instances can serve the list in ~300ms instead of
      // redoing the 10-30s chain read (the skeleton screen). Server-only, best-effort.
      if (markets.length > 0) void saveMarketListSnapshot(markets);
      return markets;
    })
    .finally(() => {
      marketFetchInFlight = null;
    });

  return marketFetchInFlight;
}

// ── DB-backed market-list snapshot (cold-start fast path) ─────────────────────

async function saveMarketListSnapshot(markets: AppMarket[]) {
  if (typeof window !== 'undefined' || !hasDatabaseUrl()) return;
  try {
    await getDb()
      .insert(marketListCache)
      .values({ key: 'latest', payload: markets, updatedAt: new Date() })
      .onConflictDoUpdate({ target: marketListCache.key, set: { payload: markets, updatedAt: new Date() } });
  } catch (err) {
    logger.warn('onchain-markets', 'market list snapshot save failed', { error: String(err) });
  }
}

/**
 * Latest persisted market list + its age. Used by /api/markets as the instant fast path on cold
 * instances; callers decide how stale is acceptable. null when no DB or no snapshot yet.
 */
export async function readMarketListSnapshot(): Promise<{ markets: AppMarket[]; ageMs: number } | null> {
  if (typeof window !== 'undefined' || !hasDatabaseUrl()) return null;
  try {
    const rows = await getDb()
      .select()
      .from(marketListCache)
      .where(eq(marketListCache.key, 'latest'))
      .limit(1);
    const row = rows[0];
    if (!row || !Array.isArray(row.payload)) return null;
    return { markets: row.payload as AppMarket[], ageMs: Date.now() - new Date(row.updatedAt).getTime() };
  } catch {
    return null;
  }
}
