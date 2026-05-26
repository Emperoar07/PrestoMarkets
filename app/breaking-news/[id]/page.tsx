'use client';

import { NewsMarketDetail } from '@/components/NewsMarketDetail';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { useParams } from 'next/navigation';

export default function Page() {
  const params = useParams();
  const id = params?.id as string;

  return (
    <>
      <SiteHeader />
      <NewsMarketDetail marketId={id} />
      <SiteFooter />
    </>
  );
}
