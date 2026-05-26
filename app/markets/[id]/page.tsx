import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const MarketDetailClient = dynamic(() => import('@/components/MarketDetailClient').then(mod => ({ default: mod.MarketDetailClient })), {
  loading: () => <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-20 text-center text-white">Loading market...</div>,
  ssr: true,
});

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <Suspense fallback={<div className="mx-auto max-w-[1100px] px-4 pb-16 pt-20 text-center text-white">Loading market...</div>}>
      <MarketDetailClient marketId={id} />
    </Suspense>
  );
}
