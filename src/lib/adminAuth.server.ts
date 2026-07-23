import type { NextRequest } from 'next/server';
import { getSocialSession } from './socialSession';
import { isAdminAddress } from './adminAuth';

/**
 * Server-side admin gate for route handlers. Returns the verified admin session, or null when the
 * caller is not signed in as an allowlisted admin. The session comes from getSocialSession, which
 * verifies a signed cookie issued only after a SIWE signature — so a caller cannot spoof the address
 * by editing a request. Callers MUST treat null as 403 before performing any agent action.
 *
 * Kept out of adminAuth.ts (which is client-bundled) because getSocialSession pulls in server-only
 * session-verification code.
 */
export function requireAdmin(request: NextRequest): { address: string } | null {
  const session = getSocialSession(request);
  if (!session || !isAdminAddress(session.address)) return null;
  return session;
}
