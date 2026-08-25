import { NextRequest, NextResponse } from 'next/server';
import { loadMarketListBounded } from '@/lib/onchainMarkets';
import { agentCancelMarket, getAgentAddress } from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';
import { fixturePairKey } from '@/lib/agentPipeline';

export const runtime = 'nodejs';
// No `maxDuration` — a Vercel route-segment directive, and a no-op under @opennextjs/cloudflare (see
// scripts/prepare-cloudflare-workers.mjs for the real Workers CPU limit, which is what binds here).

// Clean up duplicate active markets (same fixture, or an exact same-question repeat) that were
// created before the agent's same-run dedup landed. Groups Open/Closing-soon markets by fixture
// pair (Home vs Away) or, failing that, exact normalized title; within each group it KEEPS the one
// with the most volume (then the oldest) and cancels the rest — but only markets the agent resolves,
// so user markets are never touched. Defaults to a DRY RUN; pass ?apply=1 to actually cancel.
function parseVolume(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const apply = new URL(req.url).searchParams.get('apply') === '1';
    const agentAddress = getAgentAddress();
    if (!agentAddress) return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });

    // Snapshot-first with a hard time bound: duplicate detection compares titles, which don't
    // need block-fresh data.
    const all = await loadMarketListBounded();
    const active = all.filter((m) => m.status === 'Open' || m.status === 'Closing soon');

    // Group by fixture pair, else exact normalized title (so only near-identical questions group —
    // "ETH $5k" and "ETH $6k" stay separate).
    const groups = new Map<string, typeof active>();
    for (const m of active) {
      const key = fixturePairKey(m.title) ?? m.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!key) continue;
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }

    const plan: Array<{ cancel: string; title: string; volume: string; keep: string; keepVolume: string; agentOwned: boolean }> = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      // Keep the most-traded (then oldest); everything else in the group is a duplicate.
      const sorted = [...group].sort((a, b) =>
        parseVolume(b.volume) - parseVolume(a.volume)
        || (Date.parse(a.createdAt ?? '') || 0) - (Date.parse(b.createdAt ?? '') || 0));
      const keep = sorted[0];
      for (const m of sorted.slice(1)) {
        plan.push({
          cancel: m.id,
          title: m.title,
          volume: m.volume ?? '',
          keep: keep.id,
          keepVolume: keep.volume ?? '',
          agentOwned: Boolean(m.resolverAddress && m.resolverAddress.toLowerCase() === agentAddress.toLowerCase()),
        });
      }
    }

    const results: Array<{ cancel: string; title: string; action: string; error?: string; txHash?: string }> = [];
    if (apply) {
      // Wall-clock budget: each cancel is a write + receipt wait; without a cap a long plan ran
      // past the workflow's curl timeout. Remaining duplicates are picked up next tick.
      const startedAt = Date.now();
      for (const p of plan) {
        if (Date.now() - startedAt > 150_000) break;
        if (!p.agentOwned) { results.push({ cancel: p.cancel, title: p.title, action: 'skipped (not agent-resolved)' }); continue; }
        const r = await agentCancelMarket(p.cancel);
        results.push({ cancel: p.cancel, title: p.title, action: r.ok ? 'canceled' : 'failed', error: r.ok ? undefined : r.error, txHash: r.ok ? r.txHash : undefined });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: !apply,
      ran: new Date().toISOString(),
      duplicateGroups: [...groups.values()].filter((g) => g.length > 1).length,
      toCancel: plan.length,
      plan,
      results,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Dedupe failed' }, { status: 500 });
  }
}
