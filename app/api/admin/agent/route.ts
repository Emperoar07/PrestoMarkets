import { NextRequest, NextResponse } from 'next/server';
import { formatUnits, isAddress, type Address } from 'viem';
import { requireAdmin } from '@/lib/adminAuth.server';
import { redactSecrets } from '@/lib/redactSecrets';
import {
  getAgentAddress,
  getGuardianAddress,
  agentCancelMarket,
  agentResolveMarket,
  agentProposeResolution,
  agentSettleProposedResolution,
  agentProposeV3,
  agentSettleV3,
  agentResolveDisputedV3,
  agentSeedLmsrMarket,
  agentWithdrawLmsrFees,
  agentPauseLmsrMarket,
  agentUnpauseLmsrMarket,
  agentCreateMarket,
} from '@/lib/agentWallet';
import { readMarketListSnapshot, fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { createArcReadClient, ARC_USDC_DECIMALS } from '@/lib/arcClient';
import { getArcConfig } from '@/lib/arcConfig';
import { erc20Abi } from '@/lib/contracts';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { agentCreations } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import type { CreateLiveMarketInput } from '@/lib/liveActions';

export const runtime = 'nodejs';
export const maxDuration = 300;

// The cron ticks the console can trigger. Each maps to an existing /api/cron/* route which the
// server calls with CRON_SECRET server-to-server — so the console reuses all the cron budget/logic
// and the admin never handles the secret. Curated allowlist (no arbitrary route names).
const TICKS: Record<string, string> = {
  'create-market': 'market-factory',
  'auto-resolve': 'auto-resolve',
  'backfill-images': 'backfill-market-images',
  'ingest-markets': 'ingest-markets',
  'seed-open': 'seed-open-markets',
  'pause-decided': 'pause-decided-markets',
  'dedupe': 'dedupe-markets',
  'withdraw-fees': 'withdraw-fees',
  'market-snapshots': 'market-snapshots',
  'agent-fund': 'agent-fund',
  'leaderboard': 'leaderboard',
};

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Admin authorization required.' }, { status: 403 });
}

// Ticks that also have a GitHub Actions workflow_dispatch trigger, so the console can optionally
// fire the REAL workflow run (visible in the Actions tab) instead of only calling the endpoint
// directly. Value-add over the direct call: GitHub's runner history + its curl retry wrapper.
const TICK_WORKFLOWS: Record<string, string> = {
  'create-market': 'agent-tick.yml',
  'auto-resolve': 'auto-resolve.yml',
  'backfill-images': 'image-backfill.yml',
  'ingest-markets': 'ingest-markets.yml',
};

async function loadMarkets() {
  const snap = await readMarketListSnapshot().catch(() => null);
  if (snap && snap.markets.length > 0) return snap.markets;
  return await fetchOnchainMarkets().catch(() => []);
}

export async function GET(request: NextRequest) {
  if (!requireAdmin(request)) return unauthorized();

  const agentAddress = getAgentAddress();
  const guardianAddress = getGuardianAddress();

  // Agent USDC balance (best-effort; never blocks the page).
  let agentBalance = '0';
  try {
    const config = getArcConfig();
    const client = createArcReadClient();
    if (client && agentAddress && config.usdcAddress && isAddress(config.usdcAddress)) {
      const bal = await client.readContract({
        address: config.usdcAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [agentAddress as Address],
      }) as bigint;
      agentBalance = Number(formatUnits(bal, ARC_USDC_DECIMALS)).toFixed(2);
    }
  } catch { /* leave 0 */ }

  // Creation ledger, newest first, joined with live market state so each row shows what actions apply.
  let ledger: Array<{ marketId: string; title: string; trendUrl: string | null; createdAt: string }> = [];
  if (hasDatabaseUrl()) {
    try {
      const rows = await getDb().select().from(agentCreations).orderBy(desc(agentCreations.createdAt)).limit(200);
      ledger = rows.map((r) => ({ marketId: r.marketId, title: r.title, trendUrl: r.trendUrl, createdAt: r.createdAt.toISOString() }));
    } catch { /* ledger unavailable (DB down) — fall back to on-chain agent markets below */ }
  }

  const markets = await loadMarkets();
  const byId = new Map(markets.map((m) => [m.id.toLowerCase(), m]));
  const agentLc = agentAddress?.toLowerCase();

  // Every agent-resolved market with its live state + which actions are valid right now.
  const agentMarkets = markets
    .filter((m) => m.resolverAddress?.toLowerCase() === agentLc)
    .map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      amm: Boolean(m.amm),
      volume: m.volume,
      closeDate: m.closeDate,
      createdAt: m.createdAt ?? '',
      outcomes: m.outcomes.map((o) => o.label),
      paused: Boolean(m.paused),
      proposal: m.proposal ? { outcomeLabel: m.proposal.outcomeLabel, disputed: m.proposal.disputed } : null,
    }));

  // Fold the ledger in: a creation the market list doesn't know yet (fresh) still shows.
  const known = new Set(agentMarkets.map((m) => m.id.toLowerCase()));
  const ledgerOnly = ledger
    .filter((l) => !known.has(l.marketId.toLowerCase()))
    .map((l) => {
      const m = byId.get(l.marketId.toLowerCase());
      return {
        id: l.marketId,
        title: l.title,
        status: m?.status ?? 'Unknown',
        amm: Boolean(m?.amm),
        volume: m?.volume ?? '',
        closeDate: m?.closeDate ?? '',
        outcomes: m?.outcomes.map((o) => o.label) ?? [],
        paused: Boolean(m?.paused),
        proposal: null,
        createdAt: l.createdAt,
      };
    });

  return NextResponse.json({
    ok: true,
    agentAddress,
    guardianAddress,
    agentBalance,
    ticks: Object.keys(TICKS),
    ghDispatchTicks: process.env.GH_WORKFLOW_TOKEN ? Object.keys(TICK_WORKFLOWS) : [],
    counts: {
      agentMarkets: agentMarkets.length,
      open: agentMarkets.filter((m) => m.status === 'Open' || m.status === 'Closing soon').length,
      closed: agentMarkets.filter((m) => m.status === 'Closed').length,
      resolved: agentMarkets.filter((m) => m.status === 'Resolved').length,
      canceled: agentMarkets.filter((m) => m.status === 'Canceled').length,
      ledger: ledger.length,
    },
    markets: agentMarkets,
    ledgerOnly,
  });
}

export async function POST(request: NextRequest) {
  if (!requireAdmin(request)) return unauthorized();

  let body: {
    op?: 'tick' | 'market' | 'create' | 'dispatch';
    tick?: string;
    action?: string;
    marketId?: string;
    outcomeIndex?: number;
    evidenceURI?: string;
    draft?: CreateLiveMarketInput;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  // ── Trigger a cron tick server-to-server (agent creation, auto-resolve, maintenance) ──
  if (body.op === 'tick') {
    const route = body.tick ? TICKS[body.tick] : undefined;
    if (!route) return NextResponse.json({ ok: false, error: `Unknown tick. Allowed: ${Object.keys(TICKS).join(', ')}` }, { status: 400 });
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured.' }, { status: 500 });
    const origin = new URL(request.url).origin;
    try {
      const res = await fetch(`${origin}/api/cron/${route}`, {
        headers: { Authorization: `Bearer ${secret}` },
        // Bound BELOW the platform's ~180s edge-proxy reset. A long cron (market-factory,
        // auto-resolve) keeps running server-side on its own maxDuration; we just stop waiting on
        // it here and report "still running" so the client gets a clean response, not a timeout.
        signal: AbortSignal.timeout(160_000),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json(redactSecrets({ ok: res.ok, tick: body.tick, status: res.status, result: data }));
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || /abort|timeout/i.test(err.message));
      if (aborted) {
        return NextResponse.json({
          ok: true,
          tick: body.tick,
          status: 'running',
          result: { ok: true, running: true, note: 'Still running on the server (long job). Refresh in a moment to see the effect.' },
        });
      }
      return NextResponse.json(redactSecrets({ ok: false, tick: body.tick, error: err instanceof Error ? err.message : 'Tick failed.' }), { status: 502 });
    }
  }

  // ── Fire the real GitHub Actions workflow (Actions-tab visibility) ──
  if (body.op === 'dispatch') {
    const wf = body.tick ? TICK_WORKFLOWS[body.tick] : undefined;
    if (!wf) return NextResponse.json({ ok: false, error: `No GitHub workflow for this tick. Have: ${Object.keys(TICK_WORKFLOWS).join(', ')}` }, { status: 400 });
    const token = process.env.GH_WORKFLOW_TOKEN;
    const repo = process.env.GH_WORKFLOW_REPO || 'Emperoar07/PrestoMarkets';
    if (!token) return NextResponse.json({ ok: false, error: 'GitHub dispatch not configured (set GH_WORKFLOW_TOKEN).' }, { status: 501 });
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${wf}/dispatches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ ref: 'main' }),
        signal: AbortSignal.timeout(15_000),
      });
      // GitHub returns 204 No Content on success.
      if (res.status === 204) return NextResponse.json({ ok: true, tick: body.tick, result: { ok: true, note: `Dispatched ${wf} on GitHub — check the Actions tab.` } });
      const txt = await res.text().catch(() => '');
      return NextResponse.json(redactSecrets({ ok: false, tick: body.tick, error: `GitHub ${res.status}: ${txt.slice(0, 160)}` }), { status: 502 });
    } catch (err) {
      return NextResponse.json({ ok: false, tick: body.tick, error: err instanceof Error ? err.message : 'Dispatch failed.' }, { status: 502 });
    }
  }

  const agentAddress = getAgentAddress();
  if (!agentAddress) return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set.' }, { status: 500 });

  // ── Manual market creation with the agent's full create ability ──
  if (body.op === 'create') {
    if (!body.draft || !body.draft.title) return NextResponse.json({ ok: false, error: 'draft.title is required.' }, { status: 400 });
    const result = await agentCreateMarket(body.draft);
    return NextResponse.json(redactSecrets(result));
  }

  // ── Per-market agent action ──
  if (body.op === 'market') {
    const { action, marketId } = body;
    if (!marketId || !isAddress(marketId)) return NextResponse.json({ ok: false, error: 'Valid marketId required.' }, { status: 400 });

    // Enforce agent ownership server-side: only agent-resolved markets are actionable here, so this
    // console can never touch a user-created market even if the id is passed by hand.
    const markets = await loadMarkets();
    const market = markets.find((m) => m.id.toLowerCase() === marketId.toLowerCase());
    if (market && market.resolverAddress && market.resolverAddress.toLowerCase() !== agentAddress.toLowerCase()) {
      return NextResponse.json({ ok: false, error: 'Not an agent-resolved market.' }, { status: 403 });
    }
    const isAmm = Boolean(market?.amm);
    const outcomeIndex = Number.isInteger(body.outcomeIndex) ? body.outcomeIndex! : 0;
    const uri = body.evidenceURI ?? '';

    let result: { ok: boolean; txHash?: string; error?: string };
    switch (action) {
      case 'cancel': result = await agentCancelMarket(marketId); break;
      case 'seed': result = await agentSeedLmsrMarket(marketId); break;
      case 'pause': result = await agentPauseLmsrMarket(marketId); break;
      case 'unpause': result = await agentUnpauseLmsrMarket(marketId); break;
      case 'withdrawFees': result = await agentWithdrawLmsrFees(marketId); break;
      case 'propose': result = isAmm ? await agentProposeV3(marketId, outcomeIndex, uri) : await agentProposeResolution(marketId, outcomeIndex, uri); break;
      case 'settle': result = isAmm ? await agentSettleV3(marketId) : await agentSettleProposedResolution(marketId); break;
      case 'resolve': result = await agentResolveMarket(marketId, outcomeIndex, uri); break;
      case 'resolveDisputed': result = await agentResolveDisputedV3(marketId, outcomeIndex, uri); break;
      default:
        return NextResponse.json({ ok: false, error: `Unknown market action: ${action}` }, { status: 400 });
    }
    return NextResponse.json(redactSecrets(result));
  }

  return NextResponse.json({ ok: false, error: 'Unknown op. Use tick | market | create.' }, { status: 400 });
}
