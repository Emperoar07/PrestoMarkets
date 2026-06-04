import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import {
  filterAndPageMarkets,
  getPublicApiHeaders,
  parseMarketListQuery,
  publicOptionsResponse,
  serializePublicMarket,
} from '@/lib/publicApi';
import { getPublicMarkets } from '@/lib/publicMarketSource';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 30;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const headers = getPublicApiHeaders(cacheSeconds);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 120, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const query = parseMarketListQuery(new URL(request.url));
  const markets = await getPublicMarkets();
  const page = filterAndPageMarkets(markets, query);

  return NextResponse.json({
    ok: true,
    data: page.items.map(serializePublicMarket),
    page: {
      limit: query.limit,
      nextCursor: page.nextCursor,
    },
    filters: {
      category: query.category,
      status: query.status,
    },
  }, { headers });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
