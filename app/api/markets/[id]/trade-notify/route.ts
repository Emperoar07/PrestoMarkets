import { NextRequest, NextResponse } from 'next/server';
import { getSocialSession } from '@/lib/socialSession';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { notifyUser } from '@/lib/notifications';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { id: marketId } = await params;
  if (!marketId) return NextResponse.json({ error: 'marketId is required.' }, { status: 400 });

  let body: { outcome?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const markets = await fetchOnchainMarkets().catch(() => []);
    const market = markets.find((m) => m.id.toLowerCase() === marketId.toLowerCase());
    if (market && market.creatorAddress && market.creatorAddress.toLowerCase() !== session.address.toLowerCase()) {
      await notifyUser({
        address: market.creatorAddress,
        type: 'system',
        title: `Someone traded on your market`,
        body: `User ${session.address} bought ${body.amount ?? 0} USDC of "${body.outcome ?? ''}" on "${market.title}".`,
        marketId: market.id,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] trade notification failed:', error);
    return NextResponse.json({ error: 'Could not send trade notification.' }, { status: 500 });
  }
}
