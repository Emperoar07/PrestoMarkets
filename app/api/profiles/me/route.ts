import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { upsertProfile } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { sanitizeHandle, sanitizeProfileText } from '@/lib/socialValidation';

const profileRateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function PATCH(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(profileRateLimitStore, ip, { max: 10, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  let body: { handle?: string; bio?: string; avatarUrl?: string; optInLeaderboard?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const handle = sanitizeHandle(body.handle);
  try {
    const profile = await upsertProfile({
      address: session.address,
      handle: handle || null,
      bio: sanitizeProfileText(body.bio, 280),
      avatarUrl: sanitizeProfileText(body.avatarUrl, 500),
      optInLeaderboard: body.optInLeaderboard === true,
    });
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profile could not be saved.' },
      { status: 503 },
    );
  }
}
