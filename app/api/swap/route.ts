/**
 * Server-side proxy for Circle's stablecoinKits/swap endpoint.
 *
 * The browser SDK can't call api.circle.com directly because Circle's CORS preflight
 * rejects the x-user-agent header the SDK sends. We forward the request server-to-server
 * with the KIT_KEY in the Authorization header, then return the raw response. The browser
 * then executes the returned instructions[] against the user's connected wallet.
 */

import { NextResponse } from 'next/server';

const STABLECOIN_BASE = 'https://api.circle.com';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const kitKey = (process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY ?? '').trim();
  if (!kitKey) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_CIRCLE_KIT_KEY is not set' }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const res = await fetch(`${STABLECOIN_BASE}/v1/stablecoinKits/swap`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kitKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
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
