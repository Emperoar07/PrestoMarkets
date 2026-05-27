import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { SkeletonCard } from '@/components/SkeletonCard';

const LoadingFallback = () => (
  <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-20">
    <div className="grid gap-6 md:grid-cols-2">
      <SkeletonCard />
      <SkeletonCard />
    </div>
  </div>
);

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
