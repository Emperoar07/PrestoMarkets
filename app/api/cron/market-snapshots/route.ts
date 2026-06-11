import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { recordMarketSnapshots, pruneOldSnapshots, countSnapshots } from '@/lib/marketSnapshots';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Records one odds snapshot per active market so charts have dense, truthful history over
// 1W/1M/All ranges (on-chain event reconstruction only covers a short recent block window).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const markets = await fetchOnchainMarkets({ force: true });
    const active = markets.filter((m) => m.status === 'Open' || m.status === 'Closing soon' || m.status === 'Closed');

    const rows = active.map((market) => ({
      marketId: market.id,
      probabilities: market.outcomes.map((outcome) => {
        const odds = Number(outcome.odds);
        return Number.isFinite(odds) ? Math.min(1, Math.max(0, odds / 100)) : 0;
      }),
    })).filter((row) => row.probabilities.length >= 2);

    const recorded = await recordMarketSnapshots(rows);
    await pruneOldSnapshots().catch(() => undefined);
    const total = await countSnapshots().catch(() => 0);

    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      marketsSnapshotted: recorded,
      totalSnapshots: total,
    });
  } catch (error) {
    console.error('[cron] market-snapshots failed:', error);
    return NextResponse.json({ ok: false, error: 'Snapshot run failed.' }, { status: 500 });
  }
}
