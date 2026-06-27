import { NextRequest, NextResponse } from 'next/server';
import { formatUnits } from 'viem';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { agentReadLmsrAccruedFees, agentWithdrawLmsrFees, getAgentAddress } from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Sweep accrued V3 protocol fees to the treasury. Each LMSR market accrues fees into accruedFees6
// on every buy/sell; withdrawFees() is permissionless and always pays the market's immutable
// protocolFeeRecipient (the treasury set at creation). This cron triggers the sweep so the fees we
// enabled actually move on-chain instead of sitting in each market contract.
//
// Dust guard: skip markets below WITHDRAW_FEES_MIN_USDC so we never spend more agent gas on the
// withdraw tx than the fee it collects. Default 0.25 USDC.
const MIN_WITHDRAW_6 = BigInt(Math.max(0, Math.round(Number(process.env.WITHDRAW_FEES_MIN_USDC || '0.25') * 1e6)));

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 500 });
  }
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (!getAgentAddress()) {
      return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });
    }

    const all = await fetchOnchainMarkets();
    const amm = all.filter((market) => market.amm);

    const swept: Array<{ marketId: string; title: string; amount: string; txHash?: string }> = [];
    const skipped: Array<{ marketId: string; accrued: string }> = [];
    const errors: Array<{ marketId: string; error: string }> = [];
    let totalSwept6 = BigInt(0);

    for (const market of amm) {
      const accrued = await agentReadLmsrAccruedFees(market.id);
      if (accrued === null) {
        errors.push({ marketId: market.id, error: 'read accruedFees6 failed' });
        continue;
      }
      if (accrued < MIN_WITHDRAW_6) {
        if (accrued > BigInt(0)) skipped.push({ marketId: market.id, accrued: formatUnits(accrued, 6) });
        continue;
      }
      const res = await agentWithdrawLmsrFees(market.id);
      if (res.ok) {
        totalSwept6 += accrued;
        swept.push({ marketId: market.id, title: market.title, amount: formatUnits(accrued, 6), txHash: res.txHash });
      } else {
        errors.push({ marketId: market.id, error: res.error });
      }
    }

    return NextResponse.json({
      ok: true,
      ran: new Date().toISOString(),
      ammMarkets: amm.length,
      minWithdrawUsdc: formatUnits(MIN_WITHDRAW_6, 6),
      sweptCount: swept.length,
      totalSwept: formatUnits(totalSwept6, 6),
      swept,
      skipped,
      errors,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Fee sweep failed' },
      { status: 500 },
    );
  }
}
