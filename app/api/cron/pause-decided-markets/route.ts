import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import {
  agentPauseLmsrMarket,
  agentReadLmsrPaused,
  getGuardianAddress,
} from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';
import type { AppMarket } from '@/lib/appState';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Freeze trading on markets whose result is already decided BEFORE their close time, so the stale
// price can't be exploited while they wait to resolve. Two sources of targets:
//   1. Explicit list (?markets=0x..,0x..) — operator-flagged decided markets. This is the reliable
//      path for outcomes the sports feed can't infer (e.g. "Will TEAM win the World Cup?" once the
//      team is eliminated, or squad-selection questions).
//   2. Auto: sports fixtures (kickoffTime) still Open whose match the live feed reports FINISHED.
// Pausing is guardian-only and only exists on V3 (LMSR) markets — V2 has no pause, so those are
// reported as needing a manual cancel instead. The resolver unpauses right before it settles at close.
const FINISHED_RE = /finished|full.?time|\bft\b|\baet\b|\bpen\b/i;
const GENERIC_OUTCOME = /^(yes|no|draw|home|away|over|under|tie)$/i;

function isActive(m: AppMarket) {
  return m.status === 'Open' || m.status === 'Closing soon';
}

async function fixtureIsFinished(origin: string, market: AppMarket): Promise<boolean> {
  if (!market.kickoffTime) return false;
  const kickoff = new Date(market.kickoffTime).getTime();
  if (Number.isNaN(kickoff) || Date.now() < kickoff) return false; // not started → not decided
  const teams = (market.outcomes ?? []).map((o) => o.label).filter((l) => l && !GENERIC_OUTCOME.test(l));
  const home = teams[0];
  const away = teams[teams.length - 1];
  const idEvent = market.trendUrl?.match(/event\/(\d+)/)?.[1];
  if (!idEvent && !(home && away)) return false;
  const params = new URLSearchParams();
  if (idEvent) params.set('id', idEvent);
  if (home) params.set('home', home);
  if (away) params.set('away', away);
  params.set('date', new Date(kickoff).toISOString().slice(0, 10).replace(/-/g, ''));
  try {
    const res = await fetch(`${origin}/api/sports/live?${params.toString()}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return false;
    const d = await res.json();
    return FINISHED_RE.test(`${d?.status ?? ''} ${d?.progress ?? ''}`);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!getGuardianAddress()) {
      return NextResponse.json({ ok: false, error: 'GUARDIAN_PRIVATE_KEY not set — cannot pause.' }, { status: 500 });
    }
    const url = new URL(req.url);
    const origin = url.origin;
    const explicit = new Set(
      (url.searchParams.get('markets') ?? '')
        .split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.startsWith('0x')),
    );

    const all = await fetchOnchainMarkets({ force: true });
    const active = all.filter(isActive);

    // Build the target set: explicit flags + auto-detected finished fixtures.
    const targets: Array<{ market: AppMarket; reason: string }> = [];
    for (const m of active) {
      if (explicit.has(m.id.toLowerCase())) { targets.push({ market: m, reason: 'flagged' }); continue; }
      if (await fixtureIsFinished(origin, m)) targets.push({ market: m, reason: 'match-finished' });
    }

    const paused: Array<{ id: string; title: string; reason: string; txHash?: string }> = [];
    const skipped: Array<{ id: string; title: string; reason: string }> = [];
    for (const { market, reason } of targets) {
      if (!market.amm) { skipped.push({ id: market.id, title: market.title, reason: 'v2-no-pause (needs manual cancel)' }); continue; }
      const already = await agentReadLmsrPaused(market.id);
      if (already === true) { skipped.push({ id: market.id, title: market.title, reason: 'already-paused' }); continue; }
      const res = await agentPauseLmsrMarket(market.id);
      if (res.ok) paused.push({ id: market.id, title: market.title, reason, txHash: res.txHash });
      else skipped.push({ id: market.id, title: market.title, reason: `pause-failed: ${res.error}` });
    }

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      guardian: getGuardianAddress(),
      activeMarkets: active.length,
      targets: targets.length,
      pausedCount: paused.length,
      paused,
      skipped,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Pause sweep failed' }, { status: 500 });
  }
}
