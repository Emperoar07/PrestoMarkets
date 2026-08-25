import { NextRequest, NextResponse } from 'next/server';
import { verifyBearer } from '@/lib/authCompare';
import { hasDatabaseUrl } from '@/lib/db/client';
import { listLeaderboard } from '@/lib/socialDb';

export const runtime = 'nodejs';

// This route NO LONGER COMPUTES the leaderboard.
//
// It used to call getAllAccountStats(), which reconstructs every account's ledger from event logs.
// On the Workers Free plan that exceeds the fixed CPU ceiling, and the runtime's response is to kill
// the isolate — which JS cannot catch. The old code guarded itself with `maxDuration = 300`, a
// Promise.race against a 150s setTimeout, and a try/catch, then returned a graceful 200 on timeout.
// None of that could ever run: those defend against a WALL-CLOCK overrun, while the actual failure is
// a CPU kill that unwinds the whole invocation. So the endpoint 500'd, and because it is the only
// step in agent-tick without continue-on-error, it failed the entire job ~12x/day.
//
// The computation moved off-Worker to scripts/refresh-leaderboard.mjs, run by
// .github/workflows/leaderboard.yml on a GitHub Actions runner (no CPU ceiling). This endpoint is now
// a cheap read of the rows that job writes, so it doubles as a freshness check — and it cannot trip
// the ceiling no matter how many accounts exist.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!verifyBearer(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A configuration state, not a failure of this run — report it without turning a schedule red.
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: true, skipped: 'database-unavailable', rows: 0 });
  }

  try {
    const rows = await listLeaderboard({ metric: 'pnl', period: 'all' });
    // updated_at is integer(mode:'timestamp') + notNull, so drizzle hands back a Date. Guard the
    // instance anyway: a row written by an older schema could still deserialize to something else.
    const freshest = rows.reduce<Date | null>((newest, row) => {
      const updated = row.updatedAt;
      if (!(updated instanceof Date) || Number.isNaN(updated.getTime())) return newest;
      return !newest || updated > newest ? updated : newest;
    }, null);
    const ageMs = freshest ? Date.now() - freshest.getTime() : null;

    return NextResponse.json({
      ok: true,
      rows: rows.length,
      updatedAt: freshest ? freshest.toISOString() : null,
      ageMinutes: ageMs === null ? null : Math.round(ageMs / 60_000),
      // The off-Worker job runs every 2h; flag anything older than two missed cycles so a broken
      // refresh lane is visible here instead of silently serving stale ranks.
      stale: ageMs === null ? true : ageMs > 5 * 60 * 60 * 1000,
      computedBy: 'scripts/refresh-leaderboard.mjs (off-Worker)',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Leaderboard read failed.' },
      { status: 500 },
    );
  }
}
