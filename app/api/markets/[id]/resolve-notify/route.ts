import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { listMarketWatchers } from '@/lib/socialDb';
import { listMarketTraders } from '@/lib/marketIndexer';
import { notifyMany } from '@/lib/notifications';
import { Address } from 'viem';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: marketId } = await params;
  if (!marketId) return NextResponse.json({ error: 'marketId is required.' }, { status: 400 });

  let body: { action: 'resolved' | 'canceled'; outcome?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (body.action !== 'resolved' && body.action !== 'canceled') {
    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  }

  try {
    const markets = await fetchOnchainMarkets().catch(() => []);
    const market = markets.find((m) => m.id.toLowerCase() === marketId.toLowerCase());
    if (!market) return NextResponse.json({ error: 'Market not found.' }, { status: 404 });

    const watchers = await listMarketWatchers(marketId);
    const traders = await listMarketTraders(marketId as Address);
    const recipients = Array.from(new Set([...watchers, ...traders]));

    if (recipients.length > 0) {
      await notifyMany(recipients, () => ({
        type: body.action === 'resolved' ? 'market_resolved' : 'market_canceled',
        title: body.action === 'resolved'
          ? `Market resolved: ${market.title}`
          : `Market canceled & refunded: ${market.title}`,
        body: body.action === 'resolved'
          ? `Outcome: ${body.outcome ?? ''}. Claim your winnings if you held the winning side.`
          : 'All participants can claim a refund.',
        marketId: market.id,
      }));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] resolve-notify failed:', error);
    return NextResponse.json({ error: 'Could not send resolve-notify.' }, { status: 500 });
  }
}
