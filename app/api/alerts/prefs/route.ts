import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getAlertPrefs, upsertAlertPrefs } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { normalizeMarketId, parseAlertTypes } from '@/lib/socialValidation';

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
    console.error('[api] alerts/prefs failed:', error);
    return NextResponse.json(
      { error: 'Alert preferences are unavailable.' },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('alert-prefs', ip, { limit: 20, windowSec: 60 }))) {
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
    console.error('[api] alerts/prefs failed:', error);
    return NextResponse.json(
      { error: 'Alert preferences could not be saved.' },
      { status: 503 },
    );
  }
}
