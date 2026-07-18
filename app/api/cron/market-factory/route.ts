/**
 * Vercel Cron: autonomous market factory, scheduled in vercel.json.
 * Calls the full agent pipeline: Serper, Groq, Gemini, Haiku, then onchain.
 *
 * Protected by CRON_SECRET. Vercel sends it as Authorization: Bearer <secret>.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { runAgentPipeline } from '@/lib/agentPipeline';
import { appendNewMarketsToSnapshot } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';
import { runWithCronLease } from '@/lib/cronLease';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured; cron endpoints are disabled until this env var is set.' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (!verifyBearer(auth, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 240s pipeline deadline: fits inside the workflow's 290s curl AND Vercel's 300s kill, so the
    // run always finishes cleanly with partial results instead of dying mid-creation (which is how
    // the agent silently stopped creating markets whenever the RPC pool was slow).
    const leasedRun = await runWithCronLease('market-factory', 10 * 60 * 1000, () => runAgentPipeline({ deadlineMs: Date.now() + 145_000 }));
    if (!leasedRun.acquired) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'Another market-factory run already holds the lease.',
        ran: new Date().toISOString(),
      });
    }

    const results = leasedRun.value;

    const created = results.filter((r) => r.ok);
    // Make freshly created markets visible on the grid immediately — the snapshot ingests them
    // incrementally after the response instead of waiting for a successful full chain read.
    if (created.length > 0) after(async () => { await appendNewMarketsToSnapshot().catch(() => undefined); });
    const rejected = results.filter((r) => !r.ok);

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      created: created.length,
      rejected: rejected.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Pipeline failed' },
      { status: 500 },
    );
  }
}
