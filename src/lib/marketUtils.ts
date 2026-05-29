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
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return 0;
  const prob = Number.isFinite(oddsPercent) && oddsPercent > 0 ? Math.min(oddsPercent, 100) / 100 : 0.5;
  return amountUsdc / prob;
}
