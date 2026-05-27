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
