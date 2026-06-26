import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
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

    // Top up the agent from the faucet if it's low before spending on seeds.
    await ensureAgentFunded().catch(() => undefined);

    const allMarkets = await fetchOnchainMarkets();
    const open = allMarkets.filter((market) =>
      (market.status === 'Open' || market.status === 'Closing soon')
      && market.resolutionMode === 'Agent assisted'
      && market.resolverAddress?.toLowerCase() === agentAddress.toLowerCase(),
    );

    const results: Array<{ marketId: string; title: string; seeded: number[]; errors: string[] }> = [];
    const lmsrFixed: Array<{ marketId: string; title: string; action: 'seeded' | 'canceled'; detail?: string }> = [];

    for (const market of open) {
      // V3 LMSR markets are seeded with a single seed() call (the subsidy funds all outcomes). If a
      // market's seed never landed it is unbuyable (buy reverts NotSeeded), so seed it now — and if
      // the agent can't afford the seed, cancel it so users stop hitting reverts on a dead market.
      if (market.amm) {
        const seeded = await agentReadLmsrSeeded(market.id);
        if (seeded === true || seeded === null) continue;
        const seed = await agentSeedLmsrMarket(market.id);
        if (seed.ok) {
          lmsrFixed.push({ marketId: market.id, title: market.title, action: 'seeded' });
        } else {
          const cancel = await agentCancelMarket(market.id);
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
        const shares = await agentReadTotalShares(market.id, i);
        if (shares === null) { errors.push(`read outcome ${i} failed`); continue; }
        if (shares > BigInt(0)) continue; // already backed — skip
        const buy = await agentBuyShares(market.id, i, perOutcome);
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
