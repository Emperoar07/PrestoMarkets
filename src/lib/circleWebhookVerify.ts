import { createPublicKey, createVerify, type KeyObject } from 'crypto';

// Circle signs every webhook with an ASYMMETRIC ECDSA key (algorithm ECDSA_SHA_256), NOT an HMAC:
//   - header  X-Circle-Signature : base64 DER ECDSA signature over the RAW request body
//   - header  X-Circle-Key-Id    : UUID of the public key
// You fetch the public key (SPKI/DER, base64) from Circle's API by key id, cache it, and verify.
// Docs: developers.circle.com/wallets/webhook-notifications (same scheme for Gateway webhooks).
//
// This replaces the previous incorrect HMAC-of-X-Circle-Signature check, which could never validate
// a genuine Circle signature (wrong primitive) — so real webhooks were rejected while only a custom
// shared-secret bypass worked.

const publicKeyCache = new Map<string, KeyObject>();

function circleApiBase(): string {
  const base = process.env.CIRCLE_BASE_URL?.trim().replace(/\/+$/, '');
  // The publicKey endpoint lives on the main API host, mirroring the wallets base (prod vs sandbox).
  if (base) return base;
  return 'https://api.circle.com';
}

async function getCirclePublicKey(keyId: string): Promise<KeyObject | null> {
  const cached = publicKeyCache.get(keyId);
  if (cached) return cached;

  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${circleApiBase()}/v2/notifications/publicKey/${encodeURIComponent(keyId)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: { publicKey?: string; algorithm?: string } };
    const b64 = json.data?.publicKey;
    if (!b64) return null;
    const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    publicKeyCache.set(keyId, key);
    return key;
  } catch {
    return null;
  }
}

/**
 * Verify a Circle webhook's ECDSA signature over the raw body. Returns:
 *   'valid'      — signature present and verified
 *   'invalid'    — signature present but failed / key unavailable
 *   'no-signature' — no X-Circle-Signature header (caller may fall back to a shared secret)
 */
export async function verifyCircleWebhookSignature(
  headers: { get(name: string): string | null },
  rawBody: string,
): Promise<'valid' | 'invalid' | 'no-signature'> {
  const signature = headers.get('x-circle-signature') ?? headers.get('circle-signature');
  const keyId = headers.get('x-circle-key-id') ?? headers.get('circle-key-id');
  if (!signature) return 'no-signature';
  if (!keyId) return 'invalid';

  const publicKey = await getCirclePublicKey(keyId);
  if (!publicKey) return 'invalid';

  try {
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signature, 'base64')) ? 'valid' : 'invalid';
  } catch {
    return 'invalid';
  }
}
