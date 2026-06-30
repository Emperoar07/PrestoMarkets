import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer } from '@/lib/authCompare';
import { getAllAccountStats } from '@/lib/marketIndexer';
import { refreshLeaderboardCache } from '@/lib/socialDb';

export const runtime = 'nodejs';
// 300s like the other crons. The leaderboard read is the heaviest in the tick (all markets + the
// per-account ledger from event logs); a 60s budget blew past it when the RPC was throttled, 504'd
// the endpoint, and — since this is the only agent-tick step without continue-on-error — failed the
// whole run. The wider budget + the workflow's retry keep a transient blip from doing that.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!verifyBearer(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await getAllAccountStats();
    const rows = await refreshLeaderboardCache(stats, 'all');
    return NextResponse.json({
      ok: true,
      updated: rows.length,
      ranAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Leaderboard refresh failed.' },
      { status: 500 },
    );
  }
}
