import { NextRequest, NextResponse } from 'next/server';
import { PRESTO_SESSION_COOKIE } from '@/lib/socialAuth';
import { getSocialSession } from '@/lib/socialSession';

// Lightweight session probe so the client can discover whether the visitor is
// signed in (and as which address) without reading the httpOnly session cookie.
export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  return NextResponse.json({ address: session?.address ?? null });
}

// Sign out: clear the session cookie.
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PRESTO_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
