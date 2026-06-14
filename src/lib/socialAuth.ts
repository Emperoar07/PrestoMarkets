import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { eq } from 'drizzle-orm';
import { getArcConfig } from './arcConfig';
import { getDb, hasDatabaseUrl } from './db/client';
import { siweNonces } from './db/schema';

export const PRESTO_SESSION_COOKIE = 'presto_session';
export const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const ARC_SIGN_IN_CHAIN_ID = 5042002;

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
    `Chain ID: ${ARC_SIGN_IN_CHAIN_ID}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

export function parseNonceFromSiweMessage(message: string): string | null {
  const match = message.match(/^Nonce:\s*(\S+)\s*$/mi);
  return match?.[1] ?? null;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function parseSiweField(message: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = message.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, 'mi'));
  return match?.[1]?.trim() ?? null;
}

export function validateSiweMessageFields(input: {
  address: string;
  message: string;
  expectedNonce: string;
  expectedOrigin: string;
  now?: number;
  maxAgeMs?: number;
}): { ok: true; nonce: string } | { ok: false; error: string } {
  const address = normalizeSocialAddress(input.address);
  if (!address) return { ok: false, error: 'Address is invalid.' };

  const lines = input.message.split(/\r?\n/);
  const messageOrigin = lines[0]?.match(/^(.*?) wants you to sign in with your Ethereum account:$/)?.[1]?.trim();
  const messageAddress = normalizeSocialAddress(lines[1]);
  const uri = parseSiweField(input.message, 'URI');
  const version = parseSiweField(input.message, 'Version');
  const chainId = parseSiweField(input.message, 'Chain ID');
  const nonce = parseNonceFromSiweMessage(input.message);
  const issuedAt = parseSiweField(input.message, 'Issued At');
  const expectedOrigin = normalizeOrigin(input.expectedOrigin);
  const normalizedMessageOrigin = messageOrigin ? normalizeOrigin(messageOrigin) : null;
  const normalizedUriOrigin = uri ? normalizeOrigin(uri) : null;

  if (messageAddress !== address) return { ok: false, error: 'Message address does not match.' };
  if (!expectedOrigin || normalizedMessageOrigin !== expectedOrigin || normalizedUriOrigin !== expectedOrigin) {
    return { ok: false, error: 'Message origin does not match.' };
  }
  if (version !== '1') return { ok: false, error: 'Unsupported SIWE version.' };
  if (chainId !== String(ARC_SIGN_IN_CHAIN_ID)) return { ok: false, error: 'Message chain id does not match Arc.' };
  if (!nonce || nonce !== input.expectedNonce) return { ok: false, error: 'Message nonce does not match.' };
  if (!issuedAt) return { ok: false, error: 'Issued At is required.' };

  const issuedAtMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedAtMs)) return { ok: false, error: 'Issued At is invalid.' };
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? SIWE_NONCE_TTL_MS;
  if (issuedAtMs > now + 60_000) return { ok: false, error: 'Issued At is in the future.' };
  if (now - issuedAtMs > maxAgeMs) return { ok: false, error: 'SIWE message expired.' };

  return { ok: true, nonce };
}

export async function verifySiweSignature(input: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const normalized = normalizeSocialAddress(input.address);
  if (!normalized) return false;

  // 1. Fast path: plain EOA (ECDSA) — recover + compare, no RPC.
  try {
    if (await verifyMessage({
      address: normalized as Address,
      message: input.message,
      signature: input.signature as `0x${string}`,
    })) {
      return true;
    }
  } catch {
    // fall through to smart-account verification
  }

  // 2. Smart-account path (ERC-1271 for deployed accounts, ERC-6492 for counterfactual ones) via
  //    an Arc RPC call — this is how Circle passkey smart accounts prove ownership, since they have
  //    no ECDSA key to recover from.
  try {
    const config = getArcConfig();
    const client = createPublicClient({
      chain: arcTestnet,
      transport: http(config.rpcUrl || 'https://rpc.testnet.arc.network'),
    });
    return await client.verifyMessage({
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
