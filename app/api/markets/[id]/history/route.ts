import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { listMarketSnapshots } from '@/lib/marketSnapshots';

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

  // Confirmed trade syncs and the scheduled recorder persist the contract's actual quoted odds.
  // Serving those snapshots avoids per-view RPC log scans and, unlike parimutuel reconstruction,
  // remains correct for LMSR buys and sells.
  const history = await listMarketSnapshots(id).catch(() => []);
  return NextResponse.json({ history }, { headers: cacheHeaders });
}
