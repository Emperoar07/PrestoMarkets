import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { computeCreatorReputation } from '@/lib/creatorReputation';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cacheHeaders = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('profile-reputation', ip, { limit: 60, windowSec: 60 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { address } = await params;
  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Valid address is required.' }, { status: 400 });
  }

  try {
    const markets = await fetchOnchainMarkets().catch(() => []);
    const reputation = computeCreatorReputation(markets, address);
    return NextResponse.json({ reputation }, { headers: cacheHeaders });
  } catch (error) {
    console.error('[api] profiles/[address]/reputation failed:', error);
    return NextResponse.json({ error: 'Reputation is unavailable.' }, { status: 503 });
  }
}
