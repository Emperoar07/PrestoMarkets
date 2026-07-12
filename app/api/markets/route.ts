import { NextResponse, after } from 'next/server';
import { fetchOnchainMarkets, readMarketListSnapshot } from '@/lib/onchainMarkets';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';

// Inlined AI images are 50-80KB of base64 EACH — they ballooned this list past 1MB, and shipping
// that JSON became the skeleton time. Replace big data-URI images with a reference to the cacheable
// /api/market-images/[id] endpoint; the tiny branded SVGs stay inline. ?v= is a content hash so a
// regenerated image busts the edge cache.
function contentHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 199) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return (h ^ s.length).toString(36);
}

function slimImages(markets: AppMarket[]): AppMarket[] {
  return markets.map((m) => {
    const u = m.imageURI || '';
    if (u.startsWith('data:image/') && !u.startsWith('data:image/svg') && u.length > 4096) {
      return { ...m, imageURI: `/api/market-images/${m.id.toLowerCase()}?v=${contentHash(u)}` };
    }
    return m;
  });
}

// Cached market list for the app's own UI. The on-chain read is 10-30s cold, and serverless
// instances are usually cold — that read was the skeleton screen users stared at. Three layers now
// make the typical response near-instant:
//   1. Vercel CDN (Cache-Control below) serves the JSON from the edge for 60s + 5min stale.
//   2. Warm instances serve the in-process 60s cache (fetchOnchainMarkets).
//   3. COLD instances serve the DB snapshot (~300ms) written on every successful full read, and
//      refresh it in the background via after() — so no user request ever waits on the chain read.
// Only a brand-new deployment with an empty snapshot does the full read inline.
//
// Not under /api/v1, so it is NOT x402-gated — this is internal app data, not the paid public API.
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000; // beyond this the snapshot is too stale to show

export async function GET() {
  try {
    const snapshot = await readMarketListSnapshot();
    if (snapshot && snapshot.markets.length > 0) {
      // Serve ANY existing snapshot instantly — never make a user request wait on a chain read.
      // A snapshot past the freshness cap is marked stale and refreshed after the response
      // (fetchOnchainMarkets persists the new snapshot when the read lands); the previous
      // behavior of falling through to an INLINE chain read pinned requests for 25-30s whenever
      // the snapshot aged out under degraded RPCs.
      if (snapshot.ageMs > 60_000) {
        after(async () => { await fetchOnchainMarkets({ force: true }).catch(() => undefined); });
      }
      const isStale = snapshot.ageMs >= SNAPSHOT_MAX_AGE_MS;
      return NextResponse.json(
        { markets: slimImages(snapshot.markets), ...(isStale ? { stale: true } : {}) },
        {
          headers: {
            'Cache-Control': isStale
              ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=120'
              : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
          },
        },
      );
    }

    try {
      const markets = await fetchOnchainMarkets();
      return NextResponse.json(
        { markets: slimImages(markets) },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
      );
    } catch (chainError) {
      // Total RPC saturation (all keyed providers out + public legs throttled) can fail the whole
      // chain read. A STALE snapshot beats an empty grid: serve whatever we last knew (short CDN
      // cache so recovery shows fast) and keep retrying in the background.
      if (snapshot && snapshot.markets.length > 0) {
        after(async () => { await fetchOnchainMarkets({ force: true }).catch(() => undefined); });
        return NextResponse.json(
          { markets: slimImages(snapshot.markets), stale: true },
          { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120' } },
        );
      }
      throw chainError;
    }
  } catch (error) {
    return NextResponse.json(
      { markets: [], error: error instanceof Error ? error.message : 'Failed to load markets' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
