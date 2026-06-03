/**
 * Pure calibration math for agent (and creator) forecasting quality.
 *
 * Calibration answers: "when the agent says 70%, does it happen ~70% of the time?"
 * We treat `agentConfidence` as the agent's probability for the YES / first outcome of a
 * binary market — the only interpretation that supports a Brier score from stored data.
 * Markets that are not binary YES/NO, or that did not resolve, are excluded from Brier and
 * accuracy (but still counted in settlement health). This keeps the numbers honest rather
 * than inventing a per-outcome probability the pipeline never recorded.
 */

export type CalibrationMarket = {
  status: string;
  type?: string;
  createdByType?: string;
  agentConfidence?: string;
  winningOutcomeLabel?: string;
  outcomes?: Array<{ label: string }>;
  pollOptions?: string[];
};

export type ConfidenceBucket = {
  /** e.g. "70–80%" */
  label: string;
  /** Mean predicted probability of the markets in this bucket. */
  predictedAvg: number;
  /** Observed YES rate of the markets in this bucket (the calibration target). */
  observedYesRate: number;
  count: number;
};

export type AgentCalibration = {
  totalMarkets: number;
  resolved: number;
  canceled: number;
  open: number;
  /** Resolved binary YES/NO markets that had a usable confidence — the Brier/accuracy basis. */
  scored: number;
  /** Winning-outcome distribution across resolved markets. */
  outcomeSplit: Array<{ label: string; count: number }>;
  /** Mean (p − actual)² over scored markets. Lower is better. null when nothing is scorable. */
  brier: number | null;
  /** Share of scored markets where the >50% side won. null when nothing is scorable. */
  accuracy: number | null;
  /** Reliability curve: predicted vs observed by decile. */
  buckets: ConfidenceBucket[];
  /** Of markets that reached a terminal state, the share that resolved to a real outcome
   * (vs. cancel-and-refund). High = the agent picks markets that can actually be settled. */
  resolutionRate: number | null;
};

/** Parse "72%", "0.72", or "72" into a 0..1 probability. Returns null when unparseable. */
export function parseConfidence(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  if (raw.includes('%') || value > 1) value = value / 100;
  return Math.min(1, Math.max(0, value));
}

function labelsOf(market: CalibrationMarket): string[] {
  if (market.pollOptions?.length) return market.pollOptions.map((o) => o.trim());
  if (market.outcomes?.length) return market.outcomes.map((o) => o.label.trim());
  return [];
}

function isBinaryYesNo(market: CalibrationMarket): boolean {
  const labels = labelsOf(market).map((l) => l.toUpperCase());
  return labels.length === 2 && labels.includes('YES') && labels.includes('NO');
}

const DECILES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export function computeAgentCalibration(markets: CalibrationMarket[]): AgentCalibration {
  let resolved = 0;
  let canceled = 0;
  let open = 0;
  const outcomeCounts = new Map<string, number>();

  const scoredPoints: Array<{ p: number; actual: number }> = [];

  for (const market of markets) {
    const status = market.status;
    if (status === 'Resolved') resolved += 1;
    else if (status === 'Canceled') canceled += 1;
    else open += 1;

    if (status === 'Resolved' && market.winningOutcomeLabel) {
      const key = market.winningOutcomeLabel.trim() || 'Unknown';
      outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
    }

    if (status !== 'Resolved' || !isBinaryYesNo(market) || !market.winningOutcomeLabel) continue;
    const p = parseConfidence(market.agentConfidence);
    if (p === null) continue;
    const actual = market.winningOutcomeLabel.trim().toUpperCase() === 'YES' ? 1 : 0;
    scoredPoints.push({ p, actual });
  }

  const scored = scoredPoints.length;
  const brier = scored > 0 ? scoredPoints.reduce((sum, pt) => sum + (pt.p - pt.actual) ** 2, 0) / scored : null;
  const accuracy = scored > 0
    ? scoredPoints.filter((pt) => (pt.p >= 0.5 ? pt.actual === 1 : pt.actual === 0)).length / scored
    : null;

  const buckets: ConfidenceBucket[] = DECILES.map((low, i) => {
    const high = i === DECILES.length - 1 ? 1.0001 : DECILES[i + 1];
    const inBucket = scoredPoints.filter((pt) => pt.p >= low && pt.p < high);
    return {
      label: `${Math.round(low * 100)}–${Math.round(Math.min(high, 1) * 100)}%`,
      predictedAvg: inBucket.length ? inBucket.reduce((s, pt) => s + pt.p, 0) / inBucket.length : 0,
      observedYesRate: inBucket.length ? inBucket.reduce((s, pt) => s + pt.actual, 0) / inBucket.length : 0,
      count: inBucket.length,
    };
  }).filter((bucket) => bucket.count > 0);

  const closed = resolved + canceled;
  const resolutionRate = closed > 0 ? resolved / closed : null;

  return {
    totalMarkets: markets.length,
    resolved,
    canceled,
    open,
    scored,
    outcomeSplit: Array.from(outcomeCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    brier,
    accuracy,
    buckets,
    resolutionRate,
  };
}
