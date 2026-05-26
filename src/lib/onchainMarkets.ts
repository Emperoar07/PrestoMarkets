import { createPublicClient, formatUnits, http, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcConfig, getArcChainId } from './arcConfig';
import { prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { isSafeResolutionUri, parseMarketMetadata } from './marketMetadata';
import type { AppMarket } from './appState';
import type { MarketStatus, MarketType, ResolutionMode } from './markets';
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

function getMarketType(kind: number): MarketType {
  if (kind === 1) return 'Opinion';
  if (kind === 2) return 'Opportunity';
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
  if (total === BigInt(0)) return shares.map(() => Math.round(100 / Math.max(shares.length, 1)));
  return shares.map((item) => Math.round(Number((item * BigInt(100)) / total)));
}

async function readMarket(client: ReturnType<typeof createPublicClient>, address: Address, index: number): Promise<AppMarket> {
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

  return {
    id: address.toLowerCase(),
    type: marketType,
    title: metadata?.name || `Arc market ${index + 1}`,
    description: metadata?.description || `Onchain ${marketType.toLowerCase()} market created from metadata ${titleSource}.`,
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
    collateral: (metadata?.collateral === 'EURC' ? 'EURC' : 'USDC') as 'USDC' | 'EURC',
    chain: 'Arc Testnet',
    resolver: truncateAddress(resolver),
    resolverAddress: resolver,
    resolutionMode: metadata?.resolutionMode || getResolutionMode(kind),
    sourceOfTruth: metadata?.sourceOfTruth || metadataURI || 'Metadata URI was not set at creation.',
    rulesSchema: metadata?.rulesSchema ?? {
      type: marketType,
      outcomes: labels,
      sourceOfTruth: metadata?.sourceOfTruth || metadataURI || 'Metadata URI was not set at creation.',
      resolverMode: metadata?.resolutionMode || getResolutionMode(kind),
      closeRule: 'Market closes at the onchain closeTime. Resolver settles against the written rules and source of truth.',
      settlementAsset: metadata?.collateral === 'EURC' ? 'EURC' : 'USDC',
    },
    rules: resolutionURI && isSafeResolutionUri(resolutionURI)
      ? `Resolved with evidence: ${resolutionURI}. Winning outcome: ${winningLabel}.`
      : resolutionURI
        ? `Resolved. Winning outcome: ${winningLabel}. Evidence URI was rejected as unsafe.`
        : metadata?.rules || 'Rules live in the market metadata URI. Resolver evidence is published after settlement.',
    winningOutcomeLabel: status === 'Resolved' ? winningLabel : undefined,
    resolutionURI: isSafeResolutionUri(resolutionURI) ? resolutionURI : undefined,
    createdBy: truncateAddress(creator),
    createdByType: metadata?.createdByType,
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
    feeMode: Number(protocolFeeBps) > 0 ? `${protocolFeeBps} bps protocol fee` : 'No protocol fee',
    outcomes: labels.map((label, outcomeIndex) => ({
      label,
      odds: odds[outcomeIndex] ?? 0,
      liquidity: formatOnchainUsd(shares[outcomeIndex] ?? BigInt(0)),
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
    createdAt: new Date(Number(closeTime) * 1000).toISOString(),
  };
}

async function readOnchainMarkets() {
  const config = getArcConfig();

  if (!config.rpcUrl || (!config.factoryAddress && !config.multiOutcomeFactoryAddress)) {
    return [];
  }

  const chainId = getArcChainId();
  const client = createPublicClient({
    chain: {
      ...arcTestnet,
      id: chainId,
      rpcUrls: {
        ...arcTestnet.rpcUrls,
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
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
  ].filter(Boolean) as { address: Address; abi: typeof prestoMarketFactoryAbi | typeof prestoMultiOutcomeMarketFactoryAbi }[];
  const marketAddresses: Address[] = [];

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
    }
  }

  const markets: AppMarket[] = [];
  for (let i = 0; i < marketAddresses.length; i += MARKET_HYDRATION_BATCH_SIZE) {
    const batch = marketAddresses.slice(i, i + MARKET_HYDRATION_BATCH_SIZE);
    const batchMarkets = await Promise.all(
      batch.map((address, batchIndex) => withRetry(() => readMarket(client, address, i + batchIndex))),
    );
    markets.push(...batchMarkets);
  }

  return markets;
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
      return markets;
    })
    .finally(() => {
      marketFetchInFlight = null;
    });

  return marketFetchInFlight;
}
