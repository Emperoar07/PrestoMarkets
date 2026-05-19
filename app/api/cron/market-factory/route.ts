/**
 * Vercel Cron: autonomous market factory — runs every 30 minutes.
 * Calls the full agent pipeline: Serper → Groq → Gemini → Haiku → onchain.
 *
 * Protected by CRON_SECRET (Vercel sets this automatically in the x-vercel-signature header).
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAgentPipeline } from '@/lib/agentPipeline';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured — cron endpoints are disabled until this env var is set.' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await runAgentPipeline();

    const created = results.filter((r) => r.ok);
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
