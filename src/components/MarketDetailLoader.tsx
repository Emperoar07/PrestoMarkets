'use client';

import dynamic from 'next/dynamic';
import { MarketDetailSkeleton } from './MarketDetailSkeleton';
import { MarketDetailErrorBoundary } from './MarketDetailErrorBoundary';

const MarketDetailClient = dynamic(
  () => import('./MarketDetailClient').then((module) => module.MarketDetailClient),
  {
    loading: () => <MarketDetailSkeleton />,
    ssr: false,
  },
);

export function MarketDetailLoader({ marketId }: { marketId: string }) {
  // ssr:false ⇒ any render throw from one market's data would otherwise unwind to Next's bare
  // global-error page. The boundary scopes that to a retryable card and logs the failing field.
  return (
    <MarketDetailErrorBoundary>
      <MarketDetailClient marketId={marketId} />
    </MarketDetailErrorBoundary>
  );
}
