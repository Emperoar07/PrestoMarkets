import type { NextRequest } from 'next/server';
import {
  PRESTO_SESSION_COOKIE,
  getSessionSecret,
  verifySessionToken,
} from './socialAuth';

export function getSocialSession(request: NextRequest): { address: string } | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const payload = verifySessionToken(request.cookies.get(PRESTO_SESSION_COOKIE)?.value, { secret });
  return payload ? { address: payload.address } : null;
}
