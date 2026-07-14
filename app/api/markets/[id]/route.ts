import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { readMarketListSnapshot } from '@/lib/onchainMarkets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 180, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }
  const { id } = await params;
  if (!isAddress(id)) return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400 });

  const snapshot = await readMarketListSnapshot();
  const market = snapshot?.markets.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (!market) return NextResponse.json({ error: 'Market not found.' }, { status: 404 });
  return NextResponse.json({ market }, { headers: { 'Cache-Control': 'private, no-store' } });
}
