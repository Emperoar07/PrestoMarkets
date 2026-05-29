/**
 * Constant-time credential comparison helpers.
 *
 * Plain `===`/`!==` and `Buffer.equals` short-circuit on the first differing
 * byte, which leaks how many leading bytes of a secret an attacker has guessed.
 * These helpers route every comparison through `crypto.timingSafeEqual` so the
 * comparison time does not depend on the secret's contents.
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two strings in constant time. Returns false for length mismatches
 * (after a same-length dummy compare to avoid leaking length via timing) and
 * for empty/missing inputs, so callers never authenticate on an unset secret.
 */
export function secureCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;

  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on differing lengths; do a self-compare of equal
  // length first so the failure path keeps a comparable timing profile.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }

  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Bearer Authorization header against the expected token in constant
 * time. Returns false when the token is unset (fail closed).
 */
export function verifyBearer(authHeader: string | null | undefined, token: string | undefined): boolean {
  if (!token) return false;
  return secureCompare(authHeader ?? '', `Bearer ${token}`);
}

/**
 * Verify an x-api-key header against the expected key in constant time.
 * Returns false when the key is unset (fail closed).
 */
export function verifyApiKey(apiKey: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  return secureCompare(apiKey ?? '', expected);
}
