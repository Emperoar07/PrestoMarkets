import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { MarketDetailSkeleton } from '@/components/MarketDetailSkeleton';

// Shadows the real page layout (title/chart/outcomes + trade panel) so the load state looks like
// the page it becomes, instead of two generic grey cards.
const LoadingFallback = () => <MarketDetailSkeleton />;

const MarketDetailClient = dynamic(() => import('@/components/MarketDetailClient').then(mod => ({ default: mod.MarketDetailClient })), {
  loading: LoadingFallback,
  ssr: true,
});

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense fallback={<LoadingFallback />}>
      <MarketDetailClient marketId={id} />
    </Suspense>
  );
}
