const SYNC_RETRY_DELAYS_MS = [0, 2_500, 8_000];
const activeSyncs = new Set<string>();

export function scheduleMarketSnapshotSync(marketId: string, txHash?: string) {
  const key = txHash?.toLowerCase();
  if (!txHash || !key || activeSyncs.has(key)) return;
  activeSyncs.add(key);

  void (async () => {
    let elapsed = 0;
    try {
      for (const targetDelay of SYNC_RETRY_DELAYS_MS) {
        const waitMs = targetDelay - elapsed;
        if (waitMs > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        elapsed = targetDelay;
        const response = await fetch(`/api/markets/${marketId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash }),
        }).catch(() => null);
        if (response?.ok && response.status !== 202) return;
        if (response && response.status >= 400 && response.status < 500 && response.status !== 429) return;
      }
    } finally {
      activeSyncs.delete(key);
    }
  })();
}
