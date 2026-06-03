'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';

type WatchlistItem = {
  marketId: string;
  createdAt: string;
};

export function WatchlistClient() {
  const { markets, isLoadingMarkets } = useAppState();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/watchlist', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Watchlist unavailable.');
        setItems(data.items ?? []);
        setMessage('');
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Watchlist unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const watchedMarkets = useMemo(() => {
    const ids = new Set(items.map((item) => item.marketId.toLowerCase()));
    return markets.filter((market) => ids.has(market.id.toLowerCase()));
  }, [items, markets]);

  if (loading || isLoadingMarkets) {
    return <p className="mt-10 text-sm text-muted">Loading watchlist...</p>;
  }

  if (message) {
    return <p className="mt-10 text-sm text-muted">{message}</p>;
  }

  if (watchedMarkets.length === 0) {
    return (
      <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30] p-8 text-center">
        <h2 className="text-xl font-black text-white">No saved markets yet</h2>
        <p className="mt-2 text-sm text-muted">Star markets from the explorer to keep them here.</p>
      </section>
    );
  }

  return (
    <section className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {watchedMarkets.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </section>
  );
}
