// Memoization cache for volume parsing (key: volume string, value: number)
const volumeParseCache = new Map<string, number>();

/**
 * Parse volume string (e.g., "$5.2M", "$1.2K", "$100") to number.
 * Results are cached to avoid repeated parsing during sorting.
 */
export function parseVolume(v: string): number {
  if (volumeParseCache.has(v)) {
    return volumeParseCache.get(v)!;
  }

  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  if (isNaN(n)) {
    volumeParseCache.set(v, 0);
    return 0;
  }

  let result = n;
  if (v.includes('M')) result = n * 1_000_000;
  else if (v.includes('K')) result = n * 1_000;

  volumeParseCache.set(v, result);
  return result;
}

/**
 * Format number to compact volume string (e.g., "$5.2M", "$1.2K", "$100").
 */
export function formatVolume(v: number): string {
  if (v === 0) return '$0';
  if (v > 0 && v < 0.01) return '<$0.01';
  if (v < 1) return `$${v.toFixed(2)}`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * Clear volume parse cache (for testing or memory cleanup).
 */
export function clearVolumeCache(): void {
  volumeParseCache.clear();
}

function clampProbabilityPercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function distributeRoundingRemainder(values: number[], target = 100): number[] {
  const floored = values.map((value) => Math.floor(value));
  let remainder = target - floored.reduce((total, value) => total + value, 0);
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || b.index - a.index);

  for (const item of order) {
    if (remainder <= 0) break;
    floored[item.index] += 1;
    remainder -= 1;
  }

  return floored;
}

/**
 * Normalize outcome odds into whole percentages that always add to 100.
 * Presto V1 is a fixed-share parimutuel market, so these are implied
 * probabilities for display and quote estimates, not executable prices.
 */
export function normalizeOutcomeOdds(odds: number[]): number[] {
  if (odds.length === 0) return [];

  const cleaned = odds.map(clampProbabilityPercent);
  const sum = cleaned.reduce((total, value) => total + value, 0);

  if (sum <= 0) {
    return distributeRoundingRemainder(Array.from({ length: odds.length }, () => 100 / odds.length));
  }

  return distributeRoundingRemainder(cleaned.map((value) => (value / sum) * 100));
}

export type FixedShareQuote = {
  stakeUsdc: number;
  shares: number;
  impliedProbability: number;
  estimatedPayoutUsdc: number;
  estimatedProfitUsdc: number;
};

export function buildFixedShareQuote(input: { amountUsdc: number; oddsPercent: number }): FixedShareQuote {
  const stakeUsdc = Number.isFinite(input.amountUsdc) && input.amountUsdc > 0 ? input.amountUsdc : 0;
  const impliedProbability = Number.isFinite(input.oddsPercent) && input.oddsPercent > 0
    ? Math.min(input.oddsPercent, 100) / 100
    : 0.5;
  const estimatedPayoutUsdc = stakeUsdc > 0 ? stakeUsdc / impliedProbability : 0;

  return {
    stakeUsdc,
    shares: stakeUsdc,
    impliedProbability,
    estimatedPayoutUsdc,
    estimatedProfitUsdc: Math.max(0, estimatedPayoutUsdc - stakeUsdc),
  };
}

/**
 * Estimate the payout if a chosen outcome wins, for Presto's fixed-share
 * parimutuel markets. Shares are minted 1:1 with USDC (10 USDC = 10 shares),
 * and winners split the whole pool pro-rata, so payout per winning share is
 * roughly 1 / impliedProbability. At 50% odds a $10 stake estimates to ~$20;
 * at 80% odds to ~$12.50.
 *
 * This is an estimate, not a quote: the real payout depends on the final pool
 * and how shares shift before close. It is NOT a per-share price — Presto does
 * not sell priced shares.
 *
 * @param amountUsdc  USDC staked (equals shares received, 1:1)
 * @param oddsPercent current implied odds for the outcome, 0–100
 */
export function estimateParimutuelPayout(amountUsdc: number, oddsPercent: number): number {
  return buildFixedShareQuote({ amountUsdc, oddsPercent }).estimatedPayoutUsdc;
}
