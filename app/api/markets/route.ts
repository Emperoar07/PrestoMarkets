import { NextResponse, after } from 'next/server';
import { fetchOnchainMarkets, readMarketListSnapshot } from '@/lib/onchainMarkets';

export const runtime = 'nodejs';

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
    if (snapshot && snapshot.markets.length > 0 && snapshot.ageMs < SNAPSHOT_MAX_AGE_MS) {
      // Serve instantly; if the snapshot is older than the in-process cache window, refresh it
      // after the response (fetchOnchainMarkets persists the new snapshot when the read lands).
      if (snapshot.ageMs > 60_000) {
        after(async () => { await fetchOnchainMarkets({ force: true }).catch(() => undefined); });
      }
      return NextResponse.json(
        { markets: snapshot.markets },
        { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
      );
    }

    const markets = await fetchOnchainMarkets();
    return NextResponse.json(
      { markets },
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    return NextResponse.json(
      { markets: [], error: error instanceof Error ? error.message : 'Failed to load markets' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
