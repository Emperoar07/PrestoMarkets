import { NextRequest, NextResponse } from 'next/server';
import { appendNewMarketsToSnapshot } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Makes newly-created markets VISIBLE on the grid. The market list snapshot only gains new markets
// two ways: a full chain read (which resets the snapshot's age — impossible for days under RPC
// saturation) or appendNewMarketsToSnapshot (cheap incremental ingest). The latter was only wired
// as after() background work on /api/markets and market-factory — but the grid is CDN-cached, so
// most requests are served from the edge and never run the function, and market-factory times out
// before its after() fires. Result: markets created on-chain sat invisible for days (Jul 18-21).
//
// This dedicated tick runs the incremental ingest directly on a schedule, independent of CDN
// caching and the heavy timing-out routes. A few batched multicalls per run, idempotent, budgeted.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const startedAt = Date.now();
    const BUDGET_MS = 90_000;
    let ingested = 0;
    // Loop so a burst of new markets (a busy fixture day) all get ingested in one run; each pass
    // appends up to 10. Stop when a pass finds nothing new or the budget runs out.
    for (let pass = 0; pass < 8; pass++) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const n = await appendNewMarketsToSnapshot(10).catch(() => 0);
      ingested += n;
      if (n === 0) break;
    }
    return NextResponse.json({ ok: true, ran: new Date().toISOString(), ingested });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ingest failed' },
      { status: 500 },
    );
  }
}
