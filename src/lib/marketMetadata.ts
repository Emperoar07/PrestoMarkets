import type { MarketType, ResolutionMode } from './markets';

export type MarketCreatedByType = 'user' | 'admin' | 'agent';

export type AgentMarketMetadata = {
  createdByType?: MarketCreatedByType;
  agentName?: string;
  agentSource?: string;
  agentModel?: string;
  agentReason?: string;
  agentConfidence?: string;
  trendSource?: string;
  trendUrl?: string;
  momentumScore?: number;
  safetyScore?: number;
};

export type MarketMetadata = AgentMarketMetadata & {
  name: string;
  description: string;
  category: string;
  imageURI?: string;
  image?: string;
  rules: string;
  sourceOfTruth: string;
  resolutionMode: ResolutionMode;
  collateral?: 'USDC' | 'EURC';
};

export type BuildMarketMetadataInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  rules: string;
  sourceOfTruth: string;
  resolutionMode: ResolutionMode | string;
  imageURI?: string;
  collateral?: 'USDC' | 'EURC';
  agent?: AgentMarketMetadata;
};

const DATA_PREFIX = 'data:application/json,';

// Prevent unbounded AI-generated strings from bloating onchain metadata transactions
const MAX = { title: 200, description: 1000, rules: 2000, sourceOfTruth: 500, agentReason: 500, trendUrl: 300 };
function trunc(s: string | undefined, max: number): string | undefined {
  return s && s.length > max ? s.slice(0, max) : s;
}

export function buildMarketMetadata(input: BuildMarketMetadataInput): MarketMetadata {
  return {
    name: trunc(input.title, MAX.title) ?? input.title,
    description: trunc(input.description, MAX.description) ?? input.description,
    category: input.category,
    imageURI: input.imageURI,
    rules: trunc(input.rules, MAX.rules) ?? input.rules,
    sourceOfTruth: trunc(input.sourceOfTruth, MAX.sourceOfTruth) ?? input.sourceOfTruth,
    resolutionMode: input.resolutionMode as ResolutionMode,
    collateral: input.collateral ?? 'USDC',
    createdByType: input.agent?.createdByType ?? 'user',
    agentName: input.agent?.agentName,
    agentSource: input.agent?.agentSource,
    agentModel: input.agent?.agentModel,
    agentReason: trunc(input.agent?.agentReason, MAX.agentReason),
    agentConfidence: input.agent?.agentConfidence,
    trendSource: input.agent?.trendSource,
    trendUrl: trunc(input.agent?.trendUrl, MAX.trendUrl),
    momentumScore: input.agent?.momentumScore,
    safetyScore: input.agent?.safetyScore,
  };
}

export function buildMarketMetadataURI(input: BuildMarketMetadataInput) {
  return `${DATA_PREFIX}${encodeURIComponent(JSON.stringify(buildMarketMetadata(input)))}`;
}

export function parseMarketMetadata(metadataURI: string): Partial<MarketMetadata> | null {
  if (!metadataURI.startsWith(DATA_PREFIX)) return null;

  try {
    return JSON.parse(decodeURIComponent(metadataURI.slice(DATA_PREFIX.length))) as Partial<MarketMetadata>;
  } catch {
    return null;
  }
}
