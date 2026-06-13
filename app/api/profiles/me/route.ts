import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getProfile, isHandleTaken, upsertProfile } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { sanitizeHandle, sanitizeProfileText } from '@/lib/socialValidation';

// Authenticated: returns the signed-in user's full profile, including private fields (email).
export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  try {
    const profile = await getProfile(session.address);
    return NextResponse.json({
      profile: profile ?? {
        address: session.address,
        handle: null,
        bio: '',
        avatarUrl: '',
        optInLeaderboard: false,
        email: null,
        emailNotifications: false,
      },
    });
  } catch (error) {
    console.error('[api] profiles/me failed:', error);
    return NextResponse.json(
      { error: 'Profile is unavailable.' },
      { status: 503 },
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /profiles_handle_unique|duplicate key|unique constraint/i.test(message);
}

// Returns the normalized email, '' to clear it, or undefined when the input is an invalid address.
function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase().slice(0, 254);
  if (email === '') return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

export async function PATCH(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('profile', ip, { limit: 10, windowSec: 60 }))) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  let body: { handle?: string; bio?: string; avatarUrl?: string; optInLeaderboard?: boolean; email?: string; emailNotifications?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const handle = sanitizeHandle(body.handle);
  if (handle && (await isHandleTaken(handle, session.address))) {
    return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
  }

  const email = normalizeEmail(body.email);
  if (email === undefined) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }

  try {
    const profile = await upsertProfile({
      address: session.address,
      handle: handle || null,
      bio: sanitizeProfileText(body.bio, 280),
      avatarUrl: sanitizeProfileText(body.avatarUrl, 500),
      optInLeaderboard: body.optInLeaderboard === true,
      email: email || null,
      // Only enable email delivery when an address is actually present.
      emailNotifications: body.emailNotifications === true && Boolean(email),
    });
    return NextResponse.json({ profile });
  } catch (error) {
    // Fallback if two requests raced past the pre-check into the unique index.
    if (isUniqueViolation(error)) {
      return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
    }
    console.error('[api] profiles/me failed:', error);
    return NextResponse.json(
      { error: 'Profile could not be saved.' },
      { status: 503 },
    );
  }
}
