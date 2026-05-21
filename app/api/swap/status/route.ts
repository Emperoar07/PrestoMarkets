/**
 * Server-side proxy for Circle's stablecoinKits/swap/status endpoint.
 * Polls the swap result by txHash + chain. Same CORS reason as the create proxy.
 */

import { NextResponse } from 'next/server';

const STABLECOIN_BASE = 'https://api.circle.com';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const kitKey = (process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? '').trim();
  if (!kitKey) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_CIRCLE_KIT_KEY is not set' }, { status: 500 });
  }

  const url = new URL(req.url);
  const txHash = url.searchParams.get('txHash');
  const chain = url.searchParams.get('chain');
  if (!txHash || !chain) {
    return NextResponse.json({ error: 'txHash and chain are required' }, { status: 400 });
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
    parsed = { error: text };
  }
  return NextResponse.json(parsed, { status: res.status });
}
