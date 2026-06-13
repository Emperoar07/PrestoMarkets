import type { Market } from './markets';
import { deriveDisplayType } from './marketDisplay';

export interface MarketV1 {
  id: string;
  title: string;
  description: string;
  category: string;
  categories: string[];
  type: Market['type'];
  displayType: string;
  status: string;
  volume: string;
  closeLabel: string;
  imageURI?: string;
  collateral: 'USDC';
  outcomes: Array<{
    label: string;
    odds: number;
    probability: number;
  }>;
  outcomeOptions?: string[];
  sourceOfTruth: string;
  rules: string;
  createdByType: 'user' | 'admin' | 'agent';
  agent: null | {
    name?: string;
    confidence?: string;
    reason?: string;
    trendSource?: string;
    trendUrl?: string;
    momentumScore?: number;
    safetyScore?: number;
  };
}

export function toMarketV1(market: Market): MarketV1 {
  return {
    id: market.id,
    title: market.title,
    description: market.description,
    category: market.category,
    categories: market.categories?.length ? market.categories : [market.category],
    type: market.type,
    displayType: deriveDisplayType(market),
    status: market.status,
    volume: market.volume,
    closeLabel: market.closeLabel,
    imageURI: market.imageURI,
    collateral: 'USDC',
    outcomes: (market.outcomes ?? []).map((outcome) => ({
      label: outcome.label,
      odds: outcome.odds,
      probability: Number((outcome.odds / 100).toFixed(4)),
    })),
    outcomeOptions: market.pollOptions,
    sourceOfTruth: market.sourceOfTruth,
    rules: market.rules,
    createdByType: market.createdByType ?? 'user',
    agent: market.createdByType === 'agent'
      ? {
          name: market.agentName,
          confidence: market.agentConfidence,
          reason: market.agentReason,
          trendSource: market.trendSource,
          trendUrl: market.trendUrl,
          momentumScore: market.momentumScore,
          safetyScore: market.safetyScore,
        }
      : null,
  };
}

export interface LeaderboardRowV1 {
  address: string;
  period: string;
  realizedPnl: string;
  marketsTraded: number;
  resolvedCorrect: number;
  brier: string;
  accuracy: string;
  createdCount: number;
  rank: number;
}

export function toLeaderboardRowV1(row: any): LeaderboardRowV1 {
  return {
    address: String(row.address ?? '').toLowerCase(),
    period: String(row.period ?? 'all'),
    realizedPnl: String(row.realizedPnl ?? '0.000000'),
    marketsTraded: Number(row.marketsTraded ?? 0),
    resolvedCorrect: Number(row.resolvedCorrect ?? 0),
    brier: String(row.brier ?? '0.000000'),
    accuracy: String(row.accuracy ?? '0.000000'),
    createdCount: Number(row.createdCount ?? 0),
    rank: Number(row.rank ?? 0),
  };
}

export interface MarketProbabilityV1 {
  t: number;
  probabilities: number[];
}

export function toMarketProbabilityV1(point: any): MarketProbabilityV1 {
  return {
    t: Number(point.t),
    probabilities: (point.probabilities ?? []).map(Number),
  };
}

export interface ConfidenceBucketV1 {
  label: string;
  predictedAvg: number;
  observedYesRate: number;
  count: number;
}

export interface AgentCalibrationV1 {
  totalMarkets: number;
  resolved: number;
  canceled: number;
  open: number;
  scored: number;
  outcomeSplit: Array<{ label: string; count: number }>;
  brier: number | null;
  accuracy: number | null;
  buckets: ConfidenceBucketV1[];
  resolutionRate: number | null;
}

export interface AgentStatusV1 {
  name: string;
  address: string | null;
  identity: {
    registered: boolean;
    agentId: string | null;
    registry: string;
  };
  skills: string[];
  activity: {
    totalMarkets: number;
    activeMarkets: number;
    resolvedMarkets: number;
    canceledMarkets: number;
  };
  calibration: AgentCalibrationV1;
}

export function toAgentStatusV1(agent: any): AgentStatusV1 {
  return {
    name: String(agent.name ?? 'Presto Market Agent'),
    address: agent.address ? String(agent.address) : null,
    identity: {
      registered: Boolean(agent.identity?.registered),
      agentId: agent.identity?.agentId ? String(agent.identity?.agentId) : null,
      registry: String(agent.identity?.registry ?? ''),
    },
    skills: (agent.skills ?? []).map(String),
    activity: {
      totalMarkets: Number(agent.activity?.totalMarkets ?? 0),
      activeMarkets: Number(agent.activity?.activeMarkets ?? 0),
      resolvedMarkets: Number(agent.activity?.resolvedMarkets ?? 0),
      canceledMarkets: Number(agent.activity?.canceledMarkets ?? 0),
    },
    calibration: {
      totalMarkets: Number(agent.calibration?.totalMarkets ?? 0),
      resolved: Number(agent.calibration?.resolved ?? 0),
      canceled: Number(agent.calibration?.canceled ?? 0),
      open: Number(agent.calibration?.open ?? 0),
      scored: Number(agent.calibration?.scored ?? 0),
      outcomeSplit: (agent.calibration?.outcomeSplit ?? []).map((split: any) => ({
        label: String(split.label ?? ''),
        count: Number(split.count ?? 0),
      })),
      brier: typeof agent.calibration?.brier === 'number' ? agent.calibration.brier : null,
      accuracy: typeof agent.calibration?.accuracy === 'number' ? agent.calibration.accuracy : null,
      buckets: (agent.calibration?.buckets ?? []).map((bucket: any) => ({
        label: String(bucket.label ?? ''),
        predictedAvg: Number(bucket.predictedAvg ?? 0),
        observedYesRate: Number(bucket.observedYesRate ?? 0),
        count: Number(bucket.count ?? 0),
      })),
      resolutionRate: typeof agent.calibration?.resolutionRate === 'number' ? agent.calibration.resolutionRate : null,
    },
  };
}
