import { NextRequest, NextResponse, after } from 'next/server';
import { verifyBearer } from '@/lib/authCompare';
import { runImageBackfill, rebuildMarketImageCache } from '@/lib/imageBackfill';

export const runtime = 'nodejs';

// NOTE: no `maxDuration` here. It is a Vercel route-segment directive and a no-op under
// @opennextjs/cloudflare — it never granted this route the 300s it claimed. Keeping it only made the
// real constraint (the Workers Free-plan CPU ceiling, which kills the isolate uncatchably) look
// solved. The actual budget is the `budgetMs` passed below.
//
// The heavy path now lives OFF-Worker: .github/workflows/image-backfill.yml runs
// scripts/backfill-market-images.mjs on a GitHub Actions runner, which has no CPU ceiling, and it
// calls the very same runImageBackfill(). This route stays for manual dispatch and for agent-tick's
// best-effort step, bounded small so it does what it can and returns rather than being killed.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; cron endpoints are disabled until this env var is set.' },
      { status: 500 }
    );
  }

  const auth = req.headers.get('authorization');
  if (!verifyBearer(auth, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // A missing D1 binding used to return 500 here, which turned EVERY scheduled run red without
    // attempting any work — a shard deployed before the binding existed was indistinguishable from a
    // real outage. It is a configuration state, not a failure of this run, so report it as a soft
    // skip and let the off-Worker lane (which reaches D1 over REST) carry the work.
    const result = await runImageBackfill({ budgetMs: 20_000, maxPerRun: 8 });

    // Off the response path: a slow chain read must not push this run past the caller's timeout.
    if (result.processedCount > 0) after(async () => { await rebuildMarketImageCache(); });

    return NextResponse.json({ ...result, host: 'worker' });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Backfill failed' },
      { status: 500 }
    );
  }
}
