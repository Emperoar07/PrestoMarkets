import { createPublicClient, formatUnits, http, type Address } from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { prestoMarketAbi, prestoMarketFactoryAbi } from './contracts';
import { parseMarketMetadata } from './marketMetadata';
import type { AppMarket } from './appState';
import type { MarketStatus, MarketType, ResolutionMode } from './markets';
const MARKET_BATCH_SIZE = 20;
const MAX_MARKETS = 500;

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

  if (diff <= 0) return 'Open';
  if (diff <= CLOSING_SOON_MS) return 'Closing soon';
  return 'Open';
}

function getCloseLabel(status: MarketStatus, closeTime: bigint) {
  if (status === 'Resolved' || status === 'Canceled') return status;

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

  return `$${amount.toFixed(0)}`;
}

function getOdds(yesShares: bigint, noShares: bigint) {
  const total = yesShares + noShares;

  if (total === BigInt(0)) {
    return { yes: 50, no: 50 };
  }

  const yes = Math.round(Number((yesShares * BigInt(100)) / total));
  return { yes, no: 100 - yes };
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
    yesShares,
    noShares,
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
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'totalShares', args: [0] }),
    client.readContract({ address, abi: prestoMarketAbi, functionName: 'totalShares', args: [1] }),
  ]);

  const kind = Number(marketKind);
  const status = getStatus(Number(state), closeTime);
  const odds = getOdds(yesShares, noShares);
  const marketType = getMarketType(kind);
  const collateralValue = status === 'Resolved' ? resolvedCollateral : totalCollateral;
  const titleSource = metadataURI.trim().length > 0 ? metadataURI : `Market ${index + 1}`;
  const metadata = parseMarketMetadata(metadataURI);

  return {
    id: address.toLowerCase(),
    type: marketType,
    title: metadata?.name || `Arc market ${index + 1}`,
    description: metadata?.description || `Onchain ${marketType.toLowerCase()} market created from metadata ${titleSource}.`,
    imageURI: metadata?.imageURI || metadata?.image,
    category: metadata?.category || 'Onchain',
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
    rules: resolutionURI
      ? `Resolved with evidence: ${resolutionURI}. Winning outcome: ${winningOutcome === 0 ? 'YES' : 'NO'}.`
      : metadata?.rules || 'Rules live in the market metadata URI. Resolver evidence is published after settlement.',
    winningOutcomeLabel: status === 'Resolved' ? (winningOutcome === 0 ? 'YES' : 'NO') : undefined,
    resolutionURI: resolutionURI || undefined,
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
    outcomes: [
      { label: 'YES', odds: odds.yes, liquidity: formatOnchainUsd(yesShares) },
      { label: 'NO', odds: odds.no, liquidity: formatOnchainUsd(noShares) },
    ],
    activity: [
      { label: 'YES shares', value: formatOnchainUsd(yesShares) },
      { label: 'NO shares', value: formatOnchainUsd(noShares) },
      { label: 'Collateral', value: formatOnchainUsd(totalCollateral) },
    ],
    source: 'onchain',
    closeDate: new Date(Number(closeTime) * 1000).toISOString(),
    createdAt: new Date(Number(closeTime) * 1000).toISOString(),
  };
}

export async function fetchOnchainMarkets() {
  const config = getArcConfig();

  if (!config.rpcUrl || !config.factoryAddress) {
    return [];
  }

  const chainId = getArcChainId();
  const client = createPublicClient({
    chain: {
      id: chainId,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
  });

  const factoryAddress = config.factoryAddress as Address;
  const marketCount = await withRetry(() => client.readContract({
    address: factoryAddress,
    abi: prestoMarketFactoryAbi,
    functionName: 'marketCount',
  }));

  const count = Math.min(Number(marketCount), MAX_MARKETS);
  const indices = Array.from({ length: count }, (_, i) => i);
  const marketAddresses: Address[] = [];

  for (let i = 0; i < indices.length; i += MARKET_BATCH_SIZE) {
    const batch = indices.slice(i, i + MARKET_BATCH_SIZE);
    const batchAddresses = await Promise.all(
      batch.map((index) => withRetry(() => client.readContract({
        address: factoryAddress,
        abi: prestoMarketFactoryAbi,
        functionName: 'markets',
        args: [BigInt(index)],
      }))),
    );
    marketAddresses.push(...batchAddresses);
  }

  const markets: AppMarket[] = [];
  for (let i = 0; i < marketAddresses.length; i += MARKET_BATCH_SIZE) {
    const batch = marketAddresses.slice(i, i + MARKET_BATCH_SIZE);
    const batchMarkets = await Promise.all(
      batch.map((address, batchIndex) => withRetry(() => readMarket(client, address, i + batchIndex))),
    );
    markets.push(...batchMarkets);
  }

  return markets;
}
