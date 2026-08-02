import { MarketDetailLoader } from '@/components/MarketDetailLoader';

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <MarketDetailLoader marketId={id} />;
}
