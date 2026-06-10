import { NextRequest, NextResponse } from 'next/server';
import {
  PRESTO_SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  createSessionToken,
  getSessionSecret,
  normalizeSocialAddress,
} from '@/lib/socialAuth';
import { listCircleWalletAddresses } from '@/lib/circleServer';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

export const runtime = 'nodejs';

const verifyRateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Sign-in for Circle user-controlled wallets. These are smart-contract accounts that can't
// produce an ECDSA signature for SIWE, so instead we verify ownership through Circle's API:
// the userToken is a short-lived bearer that resolves (via the platform key) to the wallets
// the user controls. If the claimed address is one of them, we issue the same session cookie.
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(verifyRateLimitStore, ip, { max: 10, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json({ error: 'PRESTO_SESSION_SECRET is required.' }, { status: 503 });
  }

  let body: { address?: string; userToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const address = normalizeSocialAddress(body.address);
  const userToken = typeof body.userToken === 'string' ? body.userToken.trim() : '';
  if (!address || !userToken) {
    return NextResponse.json({ error: 'Address and Circle userToken are required.' }, { status: 400 });
  }

  let ownedAddresses: string[];
  try {
    ownedAddresses = await listCircleWalletAddresses(userToken);
  } catch (error) {
    console.error('[api] auth/verify-circle failed:', error);
    return NextResponse.json(
      { error: 'Circle verification failed.' },
      { status: 502 },
    );
  }

  if (!ownedAddresses.includes(address)) {
    return NextResponse.json({ error: 'This wallet is not linked to your Circle session.' }, { status: 401 });
  }

  const token = createSessionToken(address, { secret });
  const response = NextResponse.json({ ok: true, address });
  response.cookies.set(PRESTO_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  return response;
}
