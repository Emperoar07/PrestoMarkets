import dynamic from 'next/dynamic';
import { Suspense } from 'react';

const CreateMarketBuilder = dynamic(() => import('@/components/CreateMarketBuilder').then(mod => ({ default: mod.CreateMarketBuilder })), {
  loading: () => <div className="mx-auto max-w-[1100px] px-4 pb-16 pt-20 text-center text-white">Loading builder...</div>,
  ssr: true,
});

export default function CreateMarketPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1100px] px-4 pb-16 pt-20 text-center text-white">Loading builder...</div>}>
      <CreateMarketBuilder />
    </Suspense>
  );
}
