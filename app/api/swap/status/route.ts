/**
 * Server-side proxy for Circle's stablecoinKits/swap/status endpoint.
 * Polls the swap result by txHash + chain. Validated to reject everything
 * outside our supported Arc Testnet chain to keep the kit-key billing scoped.
 */

import { NextResponse } from 'next/server';

const STABLECOIN_BASE = 'https://api.circle.com';
const ALLOWED_CHAIN = 'Arc_Testnet';

const rateLimitWindowMs = 60_000;
const rateLimitMax = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    if (rateLimitStore.size > 5_000) {
      for (const [k, v] of rateLimitStore) if (now > v.resetAt) rateLimitStore.delete(k);
    }
    return true;
  }
  if (entry.count >= rateLimitMax) return false;
  entry.count++;
  return true;
}

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const kitKey = (process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? '').trim();
  if (!kitKey) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_CIRCLE_KIT_KEY is not set' }, { status: 500 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (!rateLimitOk(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const url = new URL(req.url);
  const txHash = (url.searchParams.get('txHash') ?? '').trim();
  const chain = (url.searchParams.get('chain') ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'txHash must be a 0x-prefixed 32-byte hex string.' }, { status: 400 });
  }
  if (chain !== ALLOWED_CHAIN) {
    return NextResponse.json({ error: `Only ${ALLOWED_CHAIN} status lookups are allowed.` }, { status: 400 });
  }

  const target = new URL('/v1/stablecoinKits/swap/status', STABLECOIN_BASE);
  target.searchParams.set('txHash', txHash);
  target.searchParams.set('chain', chain);

  const res = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${kitKey}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { error: 'Upstream returned non-JSON.' };
  }
  return NextResponse.json(parsed, { status: res.status });
}
