import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getPublicApiHeaders, publicOptionsResponse } from '@/lib/publicApi';
import { listLeaderboard } from '@/lib/socialDb';
import { parseLeaderboardQuery } from '@/lib/socialValidation';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 60;

export async function GET(request: NextRequest) {
  const headers = getPublicApiHeaders(cacheSeconds);
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 120, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const query = parseLeaderboardQuery(new URL(request.url));
  try {
    const rows = await listLeaderboard(query);
    return NextResponse.json({ ok: true, ...query, data: rows }, { headers });
  } catch (error) {
    console.error('[api] v1/leaderboard failed:', error);
    return NextResponse.json(
      { ok: false, error: 'Leaderboard unavailable.' },
      { status: 503, headers },
    );
  }
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
