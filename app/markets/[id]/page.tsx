import { MarketDetailClient } from '@/components/MarketDetailClient';

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <MarketDetailClient marketId={id} />;
}
