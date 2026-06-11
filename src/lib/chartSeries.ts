import type { Market } from './markets';
import { getOutcomeColor } from './outcomeColors';
import { normalizeOutcomeOdds } from './marketUtils';

export type ChartMarketOutcome = Pick<Market['outcomes'][number], 'label' | 'odds'>;

export type ChartProbabilityPoint = {
  t: number;
  probabilities: number[];
};

export type ChartOutcomeSeries = {
  label: string;
  odds: number;
  points: number[];
  drawPoints: number[];
  color: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasSuspiciousBinaryExtremes(outcomes: ChartMarketOutcome[], history: ChartProbabilityPoint[]) {
  if (outcomes.length !== 2) return false;
  const liveBothSidesHavePrice = outcomes.every((outcome) => outcome.odds > 1 && outcome.odds < 99);
  if (!liveBothSidesHavePrice) return false;

  return history.some((point) => {
    const probabilities = point.probabilities.slice(0, 2);
    return probabilities.some((probability) => probability <= 0.001 || probability >= 0.999);
  });
}

function toPercent(probability: number) {
  return Math.round(probability * 10000) / 100;
}

function getCredibleHistory(outcomes: ChartMarketOutcome[], history?: ChartProbabilityPoint[] | null) {
  if (!history || history.length < 1) return null;
  const cleaned = history.filter((point) => {
    const probabilities = point.probabilities.slice(0, outcomes.length);
    if (probabilities.length !== outcomes.length) return false;
    if (!probabilities.every(isFiniteProbability)) return false;
    const sum = probabilities.reduce((total, probability) => total + probability, 0);
    return sum > 0 && sum <= 1.05;
  });

  if (cleaned.length < 1) return null;
  if (hasSuspiciousBinaryExtremes(outcomes, cleaned)) return null;
  return cleaned;
}

export function buildChartOutcomeSeries(input: {
  outcomes: ChartMarketOutcome[];
  history?: ChartProbabilityPoint[] | null;
}): { series: ChartOutcomeSeries[]; hasCredibleHistory: boolean } {
  const credibleHistory = getCredibleHistory(input.outcomes, input.history);
  const hasCredibleHistory = Boolean(credibleHistory);

  const normalizedLiveOdds = normalizeOutcomeOdds(input.outcomes.map((item) => item.odds));
  const series = input.outcomes.map((outcome, index) => {
    const historyPoints = credibleHistory?.map((point) => toPercent(point.probabilities[index] ?? 0)) ?? [];
    const liveOdds = normalizedLiveOdds[index] ?? outcome.odds;
    const points = historyPoints.length > 0 ? [...historyPoints, liveOdds] : [liveOdds, liveOdds];
    return {
      label: outcome.label,
      odds: liveOdds,
      points,
      drawPoints: points.map((point) => clamp(point, 1, 99)),
      color: getOutcomeColor(index),
    };
  });

  return { series, hasCredibleHistory };
}
