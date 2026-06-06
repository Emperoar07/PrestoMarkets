import { NextRequest, NextResponse } from 'next/server';
import { ensureAgentFunded, getAgentAddress } from '@/lib/agentWallet';
import { verifyBearer } from '@/lib/authCompare';

export const runtime = 'nodejs';

// Tops up the agent wallet from the Circle faucet on demand. ?force=1 bypasses the balance
// threshold + cooldown so the faucet path can be tested directly.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured.' }, { status: 500 });
  if (!verifyBearer(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  const result = await ensureAgentFunded({ force });
  return NextResponse.json({
    agent: getAgentAddress(),
    ...result,
    ranAt: new Date().toISOString(),
  });
}
