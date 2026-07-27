import { NextRequest, NextResponse } from 'next/server';
import { buildSiweMessage, createNonce, normalizeSocialAddress } from '@/lib/socialAuth';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

const nonceRateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(nonceRateLimitStore, ip, { max: 20, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  let body: { address?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const address = normalizeSocialAddress(body.address);
  if (!address) {
    return NextResponse.json({ error: 'Valid address is required.' }, { status: 400 });
  }

  try {
    const origin = request.headers.get('origin') || `https://${request.headers.get('host') ?? 'presto-markets.vercel.app'}`;
    const nonce = await createNonce(address);
    return NextResponse.json({
      nonce,
      message: buildSiweMessage({ address, nonce, origin }),
    });
  } catch (error) {
    console.error('Error in /api/auth/nonce:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create sign-in nonce.' },
      { status: 500 }
    );
  }
}
