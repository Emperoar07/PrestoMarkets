import type { Metadata } from 'next';
import { cache } from 'react';
import { isAddress } from 'viem';
import { MarketDetailLoader } from '@/components/MarketDetailLoader';
import { readMarketListSnapshot } from '@/lib/onchainMarkets';
import type { AppMarket } from '@/lib/appState';

// Server-render the market from the persisted snapshot so the page ships real content in the
// initial HTML, instead of the ssr:false skeleton the client used to fill in only after downloading
// the whole component chunk AND a data round-trip. readMarketListSnapshot is the same tiered store
// /api/markets/[id] reads (Neon -> Upstash -> /tmp -> committed seed): bounded and failure-tolerant,
// so a cold/slow DB degrades to undefined (the client still hydrates and fetches) rather than
// blocking the render. cache() dedupes the read shared by generateMetadata and the page.
const loadInitialMarket = cache(async (id: string): Promise<AppMarket | undefined> => {
  if (!isAddress(id)) return undefined;
  try {
    const snapshot = await readMarketListSnapshot();
    return snapshot?.markets.find((m) => m.id.toLowerCase() === id.toLowerCase());
  } catch {
    return undefined;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const market = await loadInitialMarket(id);
  if (!market) return { title: 'Market · Presto Markets' };
  return {
    title: `${market.title} · Presto Markets`,
    description: market.description,
  };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initialMarket = await loadInitialMarket(id);

  return <MarketDetailLoader marketId={id} initialMarket={initialMarket} />;
}
