import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getAlertPrefs, upsertAlertPrefs } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { normalizeMarketId, parseAlertTypes } from '@/lib/socialValidation';

const alertPrefsRateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const marketId = normalizeMarketId(new URL(request.url).searchParams.get('marketId'));
  if (!marketId) return NextResponse.json({ error: 'Valid marketId is required.' }, { status: 400 });

  try {
    const prefs = await getAlertPrefs(session.address, marketId);
    return NextResponse.json({
      prefs: prefs ?? {
        address: session.address,
        marketId,
        types: { closeSoon: false, priceMove: false, resolved: false, claim: false },
        channel: 'inapp',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Alert preferences are unavailable.' },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(alertPrefsRateLimitStore, ip, { max: 20, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  let body: { marketId?: string; types?: unknown; channel?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const marketId = normalizeMarketId(body.marketId);
  if (!marketId) return NextResponse.json({ error: 'Valid marketId is required.' }, { status: 400 });

  try {
    const prefs = await upsertAlertPrefs({
      address: session.address,
      marketId,
      types: parseAlertTypes(body.types),
      channel: body.channel === 'email' ? 'email' : 'inapp',
    });
    return NextResponse.json({ prefs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Alert preferences could not be saved.' },
      { status: 503 },
    );
  }
}
