import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { addWatchlistItem, listWatchlist, removeWatchlistItem } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { normalizeMarketId } from '@/lib/socialValidation';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { notifyUser } from '@/lib/notifications';

const watchlistRateLimitStore = new Map<string, { count: number; resetAt: number }>();

async function readMarketId(request: NextRequest): Promise<string | null> {
  let body: { marketId?: string };
  try {
    body = await request.json();
  } catch {
    return null;
  }
  return normalizeMarketId(body.marketId);
}

export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  try {
    const items = await listWatchlist(session.address);
    return NextResponse.json({ items });
  } catch (error) {
    console.error('[api] watchlist failed:', error);
    return NextResponse.json(
      { error: 'Watchlist is unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(watchlistRateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const marketId = await readMarketId(request);
  if (!marketId) return NextResponse.json({ error: 'Valid marketId is required.' }, { status: 400 });

  try {
    const item = await addWatchlistItem(session.address, marketId);

    // Notify the creator that someone added their market to their watchlist. Best effort.
    try {
      const markets = await fetchOnchainMarkets().catch(() => []);
      const market = markets.find((m) => m.id.toLowerCase() === marketId.toLowerCase());
      if (market && market.creatorAddress && market.creatorAddress.toLowerCase() !== session.address.toLowerCase()) {
        await notifyUser({
          address: market.creatorAddress,
          type: 'system',
          title: `Someone watched your market`,
          body: `User ${session.address} added "${market.title}" to their watchlist.`,
          marketId: market.id,
        });
      }
    } catch (err) {
      console.error('[api] watchlist notification failed:', err);
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error('[api] watchlist failed:', error);
    return NextResponse.json(
      { error: 'Watchlist item could not be saved.' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(watchlistRateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const marketId = await readMarketId(request);
  if (!marketId) return NextResponse.json({ error: 'Valid marketId is required.' }, { status: 400 });

  try {
    await removeWatchlistItem(session.address, marketId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] watchlist failed:', error);
    return NextResponse.json(
      { error: 'Watchlist item could not be removed.' },
      { status: 503 },
    );
  }
}
