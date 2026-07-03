import { NextRequest, NextResponse } from 'next/server';
import { fetchAssetUsdPrice, fetchAssetUsdPriceAt } from '@/lib/priceResolution';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// This proxies external price APIs (CoinGecko et al.), so an unthrottled caller can burn their
// rate limits for everyone. Same in-memory guard as the other public read endpoints.
const priceRateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(priceRateLimitStore, ip, { max: 60, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const assetId = searchParams.get('assetId');
  // `at` (epoch ms) snapshots the historical price at a market's close; absent = current price.
  const at = searchParams.get('at');
  const atMs = at && /^\d+$/.test(at) ? Number(at) : null;

  if (!assetId) {
    return NextResponse.json({ error: 'Missing assetId parameter' }, { status: 400 });
  }

  try {
    const price = atMs !== null ? await fetchAssetUsdPriceAt(assetId, atMs) : await fetchAssetUsdPrice(assetId);
    if (price === null) {
      return NextResponse.json({ error: `Price for asset ${assetId} not found` }, { status: 404 });
    }
    return NextResponse.json({ price, at: atMs ?? undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to fetch price: ${message}` }, { status: 500 });
  }
}
