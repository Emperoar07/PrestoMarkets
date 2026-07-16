import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets, readMarketListSnapshot } from '@/lib/onchainMarkets';
import { agentBuyShares, agentReadTotalShares, ensureAgentFunded, getAgentAddress, agentReadLmsrSeeded, agentSeedLmsrMarket, agentCancelMarket } from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Total USDC seeded per market, split across its outcomes (capped at 1 USDC) — just enough to
// put a non-zero share on every outcome so the market can settle.
const SEED_TOTAL_USDC = 1;

// One-off / periodic backfill: markets created before liquidity seeding was added have outcomes
// with zero shares, so the resolver is forced to cancel them. This seeds any open agent market
// whose outcomes are unbacked, making them resolvable. Idempotent — only 0-share outcomes are seeded.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agentAddress = getAgentAddress();
    if (!agentAddress) {
      return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });
    }

    // Wall-clock budget so the run answers inside the workflow's 290s curl even on a slow RPC day;
    // remaining markets are picked up by the next tick (the loop is idempotent).
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 230_000;

    // Top up the agent from the faucet if it's low before spending on seeds. Bounded: the
    // faucet endpoint has hung before, and a pre-loop stall eats the whole run's budget.
    await Promise.race([
      ensureAgentFunded().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 20_000)),
    ]);

    // Snapshot-first: seeding doesn't need block-fresh data (agentReadLmsrSeeded re-checks each
    // market on-chain anyway), and the full chain read alone can eat the whole budget when the
    // RPC pool is throttled.
    const snapshot = await readMarketListSnapshot().catch(() => null);
    const allMarkets = snapshot && snapshot.markets.length > 0 && snapshot.ageMs < 30 * 60 * 1000
      ? snapshot.markets
      : await fetchOnchainMarkets().catch(() => {
        // Snapshot age only resets on a successful FULL chain read, so under sustained RPC
        // throttling it is chronically "stale" — but per-market state is re-checked on-chain
        // before every seed anyway, so an old list beats a 500 here.
        if (snapshot && snapshot.markets.length > 0) return snapshot.markets;
        throw new Error('No market list available (chain read failed, no snapshot).');
      });
    const open = allMarkets.filter((market) =>
      (market.status === 'Open' || market.status === 'Closing soon')
      && market.resolutionMode === 'Agent assisted'
      && market.resolverAddress?.toLowerCase() === agentAddress.toLowerCase(),
    );

    const results: Array<{ marketId: string; title: string; seeded: number[]; errors: string[] }> = [];
    const lmsrFixed: Array<{ marketId: string; title: string; action: 'seeded' | 'canceled'; detail?: string }> = [];

    // One market's writes (send + receipt, twice for approve+seed) can outlast the time left in
    // the run even with per-receipt timeouts. Race each market against the remaining budget and
    // stop the loop when one runs out — the next tick resumes (the loop is idempotent).
    const outOfBudget = Symbol('outOfBudget');
    const raceBudget = async <T>(work: Promise<T>): Promise<T | typeof outOfBudget> => {
      // The losing promise keeps running after the race; without a subscribed error handler a
      // late rejection is "unhandled" and crashes the function (the connection-reset failures).
      void work.catch(() => undefined);
      const remaining = TIME_BUDGET_MS - (Date.now() - startedAt);
      if (remaining <= 0) return outOfBudget;
      return Promise.race([
        work,
        new Promise<typeof outOfBudget>((resolve) => setTimeout(() => resolve(outOfBudget), remaining)),
      ]);
    };

    for (const market of open) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      // V3 LMSR markets are seeded with a single seed() call (the subsidy funds all outcomes). If a
      // market's seed never landed it is unbuyable (buy reverts NotSeeded), so seed it now — and if
      // the agent can't afford the seed, cancel it so users stop hitting reverts on a dead market.
      if (market.amm) {
        const seeded = await raceBudget(agentReadLmsrSeeded(market.id));
        if (seeded === outOfBudget) break;
        if (seeded === true || seeded === null) continue;
        const seed = await raceBudget(agentSeedLmsrMarket(market.id));
        if (seed === outOfBudget) break;
        if (seed.ok) {
          lmsrFixed.push({ marketId: market.id, title: market.title, action: 'seeded' });
        } else {
          const cancel = await raceBudget(agentCancelMarket(market.id));
          if (cancel === outOfBudget) break;
          lmsrFixed.push({ marketId: market.id, title: market.title, action: 'canceled', detail: cancel.ok ? seed.error : `seed+cancel failed: ${cancel.error}` });
        }
        continue;
      }

      const outcomeCount = market.outcomes.length;
      if (outcomeCount < 2) continue;
      const perOutcome = (SEED_TOTAL_USDC / outcomeCount).toFixed(6);
      const seeded: number[] = [];
      const errors: string[] = [];

      for (let i = 0; i < outcomeCount; i++) {
        const shares = await raceBudget(agentReadTotalShares(market.id, i));
        if (shares === outOfBudget) break;
        if (shares === null) { errors.push(`read outcome ${i} failed`); continue; }
        if (shares > BigInt(0)) continue; // already backed — skip
        const buy = await raceBudget(agentBuyShares(market.id, i, perOutcome));
        if (buy === outOfBudget) break;
        if (buy.ok) seeded.push(i);
        else errors.push(`outcome ${i}: ${buy.error ?? 'buy failed'}`);
      }

      if (seeded.length > 0 || errors.length > 0) {
        results.push({ marketId: market.id, title: market.title, seeded, errors });
      }
    }

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      openMarkets: open.length,
      marketsSeeded: results.filter((r) => r.seeded.length > 0).length,
      lmsrSeeded: lmsrFixed.filter((r) => r.action === 'seeded').length,
      lmsrCanceled: lmsrFixed.filter((r) => r.action === 'canceled').length,
      lmsrFixed,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Seed backfill failed' },
      { status: 500 },
    );
  }
}
