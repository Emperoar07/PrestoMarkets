import { NextRequest, NextResponse } from 'next/server';
import {
  appendNewMarketsToSnapshot,
  hydrateSnapshotVolumes,
  readMarketListSnapshot,
  persistHydratedSnapshot,
} from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
// No `maxDuration` — a Vercel route-segment directive, and a no-op under @opennextjs/cloudflare (see
// scripts/prepare-cloudflare-workers.mjs for the real Workers CPU limit, which is what binds here).

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
    // Work-unit bounds, NOT a wall-clock budget. What kills this route on the Workers free plan is the
    // CPU ceiling, and a time budget cannot bound CPU: nearly all the wall-clock here is spent WAITING
    // on RPC (I/O, which doesn't accrue CPU), so a run can sit well inside 90s and still be killed
    // mid-decode with an uncatchable "Worker exceeded CPU time limit." Capping the number of markets
    // decoded per run is the only bound that actually tracks CPU.
    const INGEST_PASSES = 3; // x10 markets = 30 new/run; at a 10-minute cadence that's 180/hour.
    const HYDRATE_PER_RUN = 24;
    const TICK_MS = 600_000; // matches the 10-minute schedule
    const BUDGET_MS = 60_000; // secondary guard, for a stalled RPC rather than for CPU
    let ingested = 0;
    for (let pass = 0; pass < INGEST_PASSES; pass++) {
      if (Date.now() - startedAt > BUDGET_MS) break;
      const n = await appendNewMarketsToSnapshot(10).catch(() => 0);
      ingested += n;
      if (n === 0) break;
    }

    // Refresh volumes and heal chain-final statuses off the request path (audit #5): a bounded
    // multicall wave updates card volumes and flips markets that resolved/canceled on-chain, then
    // persists. Previously this ran inline on /api/markets, blocking the grid on RPC.
    //
    // This used to hand hydrateSnapshotVolumes the ENTIRE snapshot despite calling itself bounded, so
    // its cost grew with the live-market count and eventually tripped the CPU ceiling on every busy
    // tick (intermittent 500s: fine on quiet ticks, killed on heavy ones). Now it hydrates a rotating
    // window instead. The offset is derived from the clock rather than stored, so it needs no cursor
    // state and still covers every live market within ceil(live / HYDRATE_PER_RUN) ticks.
    let hydrated = 0;
    try {
      const snapshot = await readMarketListSnapshot();
      const all = snapshot?.markets ?? [];
      // hydrateSnapshotVolumes only ever touches live markets, so rotate over just those — otherwise
      // a window landing entirely on resolved markets would do nothing and waste the tick.
      const live = all.filter((m) => m.status === 'Open' || m.status === 'Closing soon');

      if (live.length > 0) {
        const size = Math.min(HYDRATE_PER_RUN, live.length);
        const windows = Math.ceil(live.length / size);
        const offset = (Math.floor(startedAt / TICK_MS) % windows) * size;
        const fresh = await hydrateSnapshotVolumes(live.slice(offset, offset + size));

        // Merge the window back over the FULL list before persisting: persistHydratedSnapshot writes
        // whatever it is given as the entire snapshot, so passing the slice would drop every market
        // outside the window off the grid.
        const byId = new Map(fresh.map((m) => [m.id.toLowerCase(), m]));
        hydrated = await persistHydratedSnapshot(all.map((m) => byId.get(m.id.toLowerCase()) ?? m));
      }
    } catch { /* leave the snapshot as-is; next run retries */ }

    return NextResponse.json({ ok: true, ran: new Date().toISOString(), ingested, hydrated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Ingest failed' },
      { status: 500 },
    );
  }
}
