// Debounced market detail prefetch on card hover
// Ensures data is loaded before navigation click

let prefetchTimeout: NodeJS.Timeout | null = null;
let lastPrefetchTime = 0;

const PREFETCH_DEBOUNCE_MS = 200; // Only prefetch once per 200ms
const PREFETCH_COOLDOWN_MS = 500; // Don't prefetch same market more than once per 500ms
const prefetchedMarkets = new Set<string>();

export function prefetchMarketDetail(marketId: string, refreshAccountPortfolio: () => Promise<void>) {
  // Skip if we prefetched this market recently
  if (prefetchedMarkets.has(marketId)) {
    return;
  }

  // Clear existing timeout
  if (prefetchTimeout) {
    clearTimeout(prefetchTimeout);
  }

  // Debounce the prefetch to avoid excessive calls
  prefetchTimeout = setTimeout(() => {
    const now = Date.now();
    if (now - lastPrefetchTime < PREFETCH_COOLDOWN_MS) {
      return; // Too soon, skip
    }

    lastPrefetchTime = now;
    prefetchedMarkets.add(marketId);

    // Trigger account portfolio refresh in background
    void refreshAccountPortfolio().catch(() => {
      // Silently fail - prefetch errors shouldn't break UX
      prefetchedMarkets.delete(marketId);
    });

    // Clear prefetch cache after cooldown so market can be prefetched again
    setTimeout(() => {
      prefetchedMarkets.delete(marketId);
    }, PREFETCH_COOLDOWN_MS);
  }, PREFETCH_DEBOUNCE_MS);
}

export function clearPrefetchCache() {
  prefetchedMarkets.clear();
  if (prefetchTimeout) {
    clearTimeout(prefetchTimeout);
  }
}
