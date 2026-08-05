import { NextRequest, NextResponse } from 'next/server';
import {
  PRESTO_SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  buildSiweMessage,
  consumeNonce,
  createSessionToken,
  getSessionSecret,
  normalizeSocialAddress,
  validateSiweMessageFields,
  verifySiweSignature,
} from '@/lib/socialAuth';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

const verifyRateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(verifyRateLimitStore, ip, { max: 10, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json({ error: 'PRESTO_SESSION_SECRET is required.' }, { status: 503 });
  }

  let body: { address?: string; nonce?: string; message?: string; signature?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const address = normalizeSocialAddress(body.address);
  if (!address || !body.signature) {
    return NextResponse.json({ error: 'Address and signature are required.' }, { status: 400 });
  }

  const origin = request.headers.get('origin') || `https://${request.headers.get('host') ?? 'presto-markets.vercel.app'}`;
  const message = body.message || (body.nonce ? buildSiweMessage({ address, nonce: body.nonce, origin }) : '');
  const expectedNonce = body.nonce ?? '';
  const messageCheck = validateSiweMessageFields({
    address,
    message,
    expectedNonce,
    expectedOrigin: origin,
  });
  if (!messageCheck.ok) {
    return NextResponse.json({ error: messageCheck.error }, { status: 400 });
  }

  const validSignature = await verifySiweSignature({ address, message, signature: body.signature });
  const nonceConsumed = validSignature ? await consumeNonce(address, messageCheck.nonce) : false;
  if (!validSignature || !nonceConsumed) {
    return NextResponse.json({ error: 'Signature verification failed.' }, { status: 401 });
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
