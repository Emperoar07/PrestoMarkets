import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer } from '@/lib/authCompare';
import { getAllAccountStats } from '@/lib/marketIndexer';
import { refreshLeaderboardCache } from '@/lib/socialDb';

export const runtime = 'nodejs';
export const maxDuration = 60;

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
