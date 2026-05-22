/**
 * Server-side proxy for Circle's stablecoinKits/swap endpoint.
 *
 * The browser SDK can't call api.circle.com directly because Circle's CORS preflight
 * rejects the x-user-agent header the SDK sends. We forward the request server-to-server
 * with the KIT_KEY in the Authorization header, then return the raw response. The browser
 * then executes the returned instructions[] against the user's connected wallet.
 *
 * Hardening:
 *  - Only accept POSTs that match our known body shape (no SSRF via crafted chain values).
 *  - Allowlist tokenIn/tokenOut against our configured USDC/EURC addresses.
 *  - Cap amount so a runaway loop can't exhaust the kit-key billing.
 *  - Per-IP rate limit (loose; serverless instances each have their own counter).
 */

import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { getArcConfig } from '@/lib/arcConfig';

const STABLECOIN_BASE = 'https://api.circle.com';
const ALLOWED_CHAIN = 'Arc_Testnet';
const MAX_AMOUNT_BASE_UNITS = BigInt(1_000_000) * BigInt(1_000_000); // 1,000,000 USDC/EURC

const rateLimitWindowMs = 60_000;
const rateLimitMax = 30;
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

function knownStableAddresses(): Set<string> {
  const config = getArcConfig();
  const out = new Set<string>();
  if (config.usdcAddress && isAddress(config.usdcAddress)) out.add(config.usdcAddress.toLowerCase());
  if (config.eurcAddress && isAddress(config.eurcAddress)) out.add(config.eurcAddress.toLowerCase());
  return out;
}

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const kitKey = (process.env.CIRCLE_KIT_KEY ?? '').trim();
  if (!kitKey) {
    return NextResponse.json({ error: 'CIRCLE_KIT_KEY is not set' }, { status: 500 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  if (!rateLimitOk(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate the body shape so a caller can't smuggle other chains, arbitrary tokens, or
  // unbounded amounts through our authenticated proxy.
  const tokenInAddress = String(body.tokenInAddress ?? '').toLowerCase();
  const tokenOutAddress = String(body.tokenOutAddress ?? '').toLowerCase();
  const tokenInChain = String(body.tokenInChain ?? '');
  const tokenOutChain = String(body.tokenOutChain ?? '');
  const fromAddress = String(body.fromAddress ?? '');
  const toAddress = String(body.toAddress ?? '');
  const amount = String(body.amount ?? '');

  if (tokenInChain !== ALLOWED_CHAIN || tokenOutChain !== ALLOWED_CHAIN) {
    return NextResponse.json({ error: `Only ${ALLOWED_CHAIN} swaps are allowed via this proxy.` }, { status: 400 });
  }
  const allowedStables = knownStableAddresses();
  if (!allowedStables.has(tokenInAddress) || !allowedStables.has(tokenOutAddress)) {
    return NextResponse.json({ error: 'tokenInAddress and tokenOutAddress must reference configured USDC or EURC.' }, { status: 400 });
  }
  if (!isAddress(fromAddress) || !isAddress(toAddress)) {
    return NextResponse.json({ error: 'fromAddress and toAddress must be valid EVM addresses.' }, { status: 400 });
  }
  if (!/^\d+$/.test(amount)) {
    return NextResponse.json({ error: 'amount must be a numeric string in base units.' }, { status: 400 });
  }
  if (BigInt(amount) > MAX_AMOUNT_BASE_UNITS) {
    return NextResponse.json({ error: 'amount exceeds proxy cap.' }, { status: 400 });
  }

  const res = await fetch(`${STABLECOIN_BASE}/v1/stablecoinKits/swap`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kitKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ tokenInAddress, tokenInChain, tokenOutAddress, tokenOutChain, fromAddress, toAddress, amount }),
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
