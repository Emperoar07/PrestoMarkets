import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import {
  filterAndPageMarkets,
  getPublicApiHeaders,
  parseMarketListQuery,
  publicOptionsResponse,
} from '@/lib/publicApi';
import { getPublicMarkets } from '@/lib/publicMarketSource';
import { toMarketV1 } from '@/lib/apiContracts';
import { requireX402Payment } from '@/lib/x402Server';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 30;

export async function GET(request: NextRequest) {
  const paywall = await requireX402Payment(request);
  if (paywall) return paywall;

  const ip = getClientIp(request.headers);
  const headers = getPublicApiHeaders(cacheSeconds);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 120, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ apiVersion: 1, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const query = parseMarketListQuery(new URL(request.url));
  const markets = await getPublicMarkets();
  const page = filterAndPageMarkets(markets, query);

  return NextResponse.json({
    apiVersion: 1,
    data: {
      items: page.items.map(toMarketV1),
      page: {
        limit: query.limit,
        nextCursor: page.nextCursor,
      },
      filters: {
        category: query.category,
        status: query.status,
      },
    },
  }, { headers });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
