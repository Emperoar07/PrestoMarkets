import { NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';

export const runtime = 'nodejs';

// Cached market list for the app's own UI. The on-chain read is ~13s cold for ~74 markets; doing it
// in every browser made the grid show skeletons for that long on each fresh load. Running it on the
// server lets ALL users share one read: the in-process 60s cache (fetchOnchainMarkets) means most
// requests to a warm instance return in ~1s, and the Cache-Control below lets Vercel's CDN serve the
// JSON from the edge for 30s (stale-while-revalidate) so the typical response is near-instant.
//
// Not under /api/v1, so it is NOT x402-gated — this is internal app data, not the paid public API.
export async function GET() {
  try {
    const markets = await fetchOnchainMarkets();
    return NextResponse.json(
      { markets },
      {
        headers: {
          // Browser doesn't cache (max-age=0) so it always revalidates; the CDN caches for 30s and
          // serves stale up to 60s more while it refreshes in the background.
          'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { markets: [], error: error instanceof Error ? error.message : 'Failed to load markets' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
