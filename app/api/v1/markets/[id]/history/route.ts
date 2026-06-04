import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getMarketProbabilityHistory } from '@/lib/marketHistory';
import { getPublicApiHeaders, publicOptionsResponse } from '@/lib/publicApi';
import { getPublicMarket } from '@/lib/publicMarketSource';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 20;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = getPublicApiHeaders(cacheSeconds);
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 180, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const { id } = await params;
  const market = await getPublicMarket(id);
  if (!market) {
    return NextResponse.json({ ok: false, error: 'Market not found.' }, { status: 404, headers });
  }

  const history = await getMarketProbabilityHistory(market.id);
  return NextResponse.json({
    ok: true,
    marketId: market.id,
    data: history,
  }, { headers });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
