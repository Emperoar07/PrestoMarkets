import { NextRequest, NextResponse } from 'next/server';
import { fetchAssetUsdPrice } from '@/lib/priceResolution';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get('assetId');

  if (!assetId) {
    return NextResponse.json({ error: 'Missing assetId parameter' }, { status: 400 });
  }

  try {
    const price = await fetchAssetUsdPrice(assetId);
    if (price === null) {
      return NextResponse.json({ error: `Price for asset ${assetId} not found` }, { status: 404 });
    }
    return NextResponse.json({ price });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to fetch price: ${message}` }, { status: 500 });
  }
}
