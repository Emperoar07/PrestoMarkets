import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { listMarketSnapshots } from '@/lib/marketSnapshots';
import { getPublicApiHeaders, publicOptionsResponse } from '@/lib/publicApi';
import { getPublicMarket } from '@/lib/publicMarketSource';
import { toMarketProbabilityV1 } from '@/lib/apiContracts';
import { requireX402Payment } from '@/lib/x402Server';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 20;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paywall = await requireX402Payment(request);
  if (paywall) return paywall;

  const headers = getPublicApiHeaders(cacheSeconds);
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 180, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ apiVersion: 1, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const { id } = await params;
  const market = await getPublicMarket(id);
  if (!market) {
    return NextResponse.json({ apiVersion: 1, error: 'Market not found.' }, { status: 404, headers });
  }

  const history = await listMarketSnapshots(market.id);
  return NextResponse.json({
    apiVersion: 1,
    data: {
      marketId: market.id,
      history: history.map(toMarketProbabilityV1),
    },
  }, { headers });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
