import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getMarketProbabilityHistory } from '@/lib/marketHistory';
import { listMarketSnapshots, mergeHistory } from '@/lib/marketSnapshots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const historyRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheHeaders = { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(historyRateLimitStore, ip, { max: 60, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { id } = await params;
  if (!isAddress(id)) {
    return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400 });
  }

  // Two complementary sources: trade events give intra-hour moves over the recent block
  // window; stored snapshots give dense long-range (1W/1M/All) history.
  const [events, snapshots] = await Promise.all([
    getMarketProbabilityHistory(id).catch(() => []),
    listMarketSnapshots(id).catch(() => []),
  ]);
  const history = mergeHistory(events, snapshots);
  return NextResponse.json({ history }, { headers: cacheHeaders });
}
