import { EmbeddedMarketClient } from '@/components/EmbeddedMarketClient';

export default async function EmbeddedMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmbeddedMarketClient marketId={id} />;
}
