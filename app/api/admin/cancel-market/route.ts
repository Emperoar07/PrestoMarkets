import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { agentCancelMarket, getAgentAddress } from '@/lib/agentWallet';
import { readMarketListSnapshot, fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Operator escape hatch: cancel (refund) specific agent-resolved markets by address — e.g.
// placeholder-team fixtures ("Semifinal 1 Loser vs Semifinal 2 Loser") that predate the
// placeholder guard. Same auth as the crons; only markets the agent resolves can be canceled,
// so user-created markets are untouchable through this route.
//
//   POST /api/admin/cancel-market  { "marketIds": ["0x..", "0x.."] }
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const agentAddress = getAgentAddress();
  if (!agentAddress) return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });

  let marketIds: string[];
  try {
    const body = await req.json() as { marketIds?: unknown };
    marketIds = Array.isArray(body.marketIds) ? body.marketIds.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    marketIds = [];
  }
  marketIds = marketIds.filter((id) => isAddress(id)).slice(0, 10);
  if (marketIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Provide marketIds: an array of up to 10 market addresses.' }, { status: 400 });
  }

  // Resolve each target against the market list so the agent-resolver ownership check is
  // enforced server-side, not trusted from the caller.
  const snapshot = await readMarketListSnapshot().catch(() => null);
  const markets = snapshot && snapshot.markets.length > 0
    ? snapshot.markets
    : await fetchOnchainMarkets().catch(() => []);
  const byId = new Map(markets.map((m) => [m.id.toLowerCase(), m]));

  const results: Array<{ marketId: string; action: string; txHash?: string; error?: string }> = [];
  for (const marketId of marketIds) {
    const market = byId.get(marketId.toLowerCase());
    if (!market) { results.push({ marketId, action: 'skipped', error: 'Unknown market.' }); continue; }
    if (market.resolverAddress?.toLowerCase() !== agentAddress.toLowerCase()) {
      results.push({ marketId, action: 'skipped', error: 'Not agent-resolved.' });
      continue;
    }
    if (market.status === 'Resolved' || market.status === 'Canceled') {
      results.push({ marketId, action: 'skipped', error: `Already ${market.status}.` });
      continue;
    }
    const r = await agentCancelMarket(marketId);
    results.push(r.ok
      ? { marketId, action: 'canceled', txHash: r.txHash }
      : { marketId, action: 'failed', error: r.error });
  }

  return NextResponse.json({ ok: true, ran: new Date().toISOString(), results });
}
