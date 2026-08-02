'use client';

import dynamic from 'next/dynamic';
import { MarketDetailSkeleton } from './MarketDetailSkeleton';

const MarketDetailClient = dynamic(
  () => import('./MarketDetailClient').then((module) => module.MarketDetailClient),
  {
    loading: () => <MarketDetailSkeleton />,
    ssr: false,
  },
);

export function MarketDetailLoader({ marketId }: { marketId: string }) {
  return <MarketDetailClient marketId={marketId} />;
}
