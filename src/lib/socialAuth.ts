import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, verifyMessage, type Address } from 'viem';
import { eq } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { siweNonces } from './db/schema';

export const PRESTO_SESSION_COOKIE = 'presto_session';
export const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StoredNonce = {
  nonce: string;
  expiresAt: number;
};

type SessionPayload = {
  address: string;
  exp: number;
};

// In-memory fallback for local/dev/tests with no database. Production uses the siwe_nonces
// table so the nonce survives across serverless instances between /nonce and /verify.
const nonceStore = new Map<string, StoredNonce>();

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signPayload(payload: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payload).digest());
}

export function normalizeSocialAddress(value: string | undefined | null): string | null {
  if (!value || !isAddress(value)) return null;
  return getAddress(value as Address).toLowerCase();
}

export async function createNonce(address: string, now = Date.now()): Promise<string> {
  const normalized = normalizeSocialAddress(address);
  if (!normalized) {
    throw new Error('Valid address is required.');
  }
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = now + SIWE_NONCE_TTL_MS;

  if (hasDatabaseUrl()) {
    await getDb()
      .insert(siweNonces)
      .values({ address: normalized, nonce, expiresAt: new Date(expiresAt) })
      .onConflictDoUpdate({ target: siweNonces.address, set: { nonce, expiresAt: new Date(expiresAt) } });
  } else {
    nonceStore.set(normalized, { nonce, expiresAt });
  }
  return nonce;
}

export async function consumeNonce(address: string, nonce: string, now = Date.now()): Promise<boolean> {
  const normalized = normalizeSocialAddress(address);
  if (!normalized) return false;

  if (hasDatabaseUrl()) {
    // Atomic single-use: delete-and-return so a replay finds nothing.
    const [row] = await getDb().delete(siweNonces).where(eq(siweNonces.address, normalized)).returning();
    return Boolean(row && row.nonce === nonce && row.expiresAt.getTime() >= now);
  }

  const stored = nonceStore.get(normalized);
  nonceStore.delete(normalized);
  return Boolean(stored && stored.nonce === nonce && stored.expiresAt >= now);
}

export function buildSiweMessage(input: {
  address: string;
  nonce: string;
  origin?: string;
  issuedAt?: Date;
}): string {
  const origin = input.origin?.trim() || 'https://presto-markets.vercel.app';
  const issuedAt = (input.issuedAt ?? new Date()).toISOString();
  return [
    `${origin} wants you to sign in with your Ethereum account:`,
    input.address,
    '',
    'Sign in to Presto Markets to write comments, edit your profile, and manage your watchlist.',
    '',
    `URI: ${origin}`,
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${input.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export function parseNonceFromSiweMessage(message: string): string | null {
  const match = message.match(/^Nonce:\s*(\S+)\s*$/mi);
  return match?.[1] ?? null;
}

export async function verifySiweSignature(input: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const normalized = normalizeSocialAddress(input.address);
  if (!normalized) return false;
  try {
    return await verifyMessage({
      address: normalized as Address,
      message: input.message,
      signature: input.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

export function getSessionSecret(): string | null {
  return process.env.PRESTO_SESSION_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? null;
}

export function createSessionToken(address: string, options: {
  secret: string;
  now?: number;
  maxAgeMs?: number;
}): string {
  const normalized = normalizeSocialAddress(address);
  if (!normalized) {
    throw new Error('Valid address is required.');
  }
  const payload: SessionPayload = {
    address: normalized,
    exp: (options.now ?? Date.now()) + (options.maxAgeMs ?? SESSION_MAX_AGE_MS),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${signPayload(encoded, options.secret)}`;
}

export function verifySessionToken(token: string | undefined | null, options: {
  secret: string;
  now?: number;
}): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.', 2);
  if (!payload || !signature) return null;

  const expected = signPayload(payload, options.secret);
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload).toString('utf8')) as SessionPayload;
    const address = normalizeSocialAddress(parsed.address);
    if (!address || parsed.exp < (options.now ?? Date.now())) return null;
    return { address, exp: parsed.exp };
  } catch {
    return null;
  }
}
