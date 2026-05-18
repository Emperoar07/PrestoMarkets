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
  agent?: AgentMarketMetadata;
};

const DATA_PREFIX = 'data:application/json,';

export function buildMarketMetadata(input: BuildMarketMetadataInput): MarketMetadata {
  return {
    name: input.title,
    description: input.description,
    category: input.category,
    imageURI: input.imageURI,
    rules: input.rules,
    sourceOfTruth: input.sourceOfTruth,
    resolutionMode: input.resolutionMode as ResolutionMode,
    createdByType: input.agent?.createdByType ?? 'user',
    agentName: input.agent?.agentName,
    agentSource: input.agent?.agentSource,
    agentModel: input.agent?.agentModel,
    agentReason: input.agent?.agentReason,
    agentConfidence: input.agent?.agentConfidence,
    trendSource: input.agent?.trendSource,
    trendUrl: input.agent?.trendUrl,
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
