import { NextRequest, NextResponse } from 'next/server';
import { isAddress, isHash } from 'viem';
import { createArcReadClient } from '@/lib/arcClient';
import { fetchOnchainMarket, patchMarketListSnapshot, readMarketListSnapshot } from '@/lib/onchainMarkets';
import { recordMarketSnapshots } from '@/lib/marketSnapshots';
import { checkFixedWindowRateLimit, getClientIp, hasBrowserOriginSignal, isTrustedBrowserOrigin } from '@/lib/requestGuards';
import { receiptTouchesMarket } from '@/lib/marketSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  }
  if (hasBrowserOriginSignal(request.headers) && !isTrustedBrowserOrigin(request.headers, [process.env.NEXT_PUBLIC_APP_URL])) {
    return NextResponse.json({ error: 'Untrusted origin.' }, { status: 403 });
  }

  const { id } = await params;
  if (!isAddress(id)) return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400 });
  const body = await request.json().catch(() => null) as { txHash?: string } | null;
  if (!body?.txHash || !isHash(body.txHash)) {
    return NextResponse.json({ error: 'Valid transaction hash is required.' }, { status: 400 });
  }

  const client = createArcReadClient();
  if (!client) return NextResponse.json({ error: 'Arc client unavailable.' }, { status: 503 });
  const receipt = await client.getTransactionReceipt({ hash: body.txHash }).catch(() => null);
  if (!receipt) return NextResponse.json({ pending: true }, { status: 202 });
  if (!receiptTouchesMarket(receipt, id)) {
    return NextResponse.json({ error: 'Transaction did not update this market.' }, { status: 422 });
  }

  const snapshot = await readMarketListSnapshot();
  const existing = snapshot?.markets.find((market) => market.id.toLowerCase() === id.toLowerCase());
  const fresh = await fetchOnchainMarket(id, { isAmm: existing?.amm });
  if (!fresh) return NextResponse.json({ error: 'Market refresh failed.' }, { status: 503 });

  await Promise.all([
    patchMarketListSnapshot(fresh),
    recordMarketSnapshots([{
      marketId: fresh.id,
      probabilities: fresh.outcomes.map((outcome) => Math.min(1, Math.max(0, Number(outcome.odds) / 100))),
    }]),
  ]);
  return NextResponse.json({ ok: true, market: fresh });
}
