// Single source of truth for "is this market image good enough to display?" Used by the reader
// (to decide when a stored override should replace the on-chain image) and the backfill cron (to
// decide which markets still need a real subject image). Keeping one definition means a broken or
// untrusted image URL is treated identically everywhere — no market is left showing a letter tile.

// Hosts we trust to reliably serve a working image. Anything else (or a branded SVG fallback /
// empty value) is treated as "not good" so the backfill re-resolves it and the reader prefers a
// stored override.
export const TRUSTED_IMG_HOSTS = [
  'assets.coingecko.com', 'coin-images.coingecko.com', 'flagcdn.com', 'upload.wikimedia.org',
  'r2.thesportsdb.com', 'www.thesportsdb.com', 'thesportsdb.com', 'a.espncdn.com', 'a1.espncdn.com',
];

export function hasGoodImage(uri: string | undefined | null): boolean {
  if (!uri || uri.trim().length === 0) return false;
  const v = uri.trim();
  if (v.startsWith('data:image/svg+xml')) return false; // branded fallback — upgrade if possible
  if (v.startsWith('data:')) return true; // a real data-image payload is fine
  try {
    const host = new URL(v).hostname.toLowerCase();
    return TRUSTED_IMG_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
