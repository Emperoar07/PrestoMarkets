import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { agentSettlePosition } from '@/lib/agentWallet';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';

type AgentSettlementRequest = {
  marketAddress?: string;
  action?: 'claim' | 'refund';
};

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  if (!validKey || apiKey !== validKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: AgentSettlementRequest;
  try {
    body = await req.json() as AgentSettlementRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.marketAddress || !isAddress(body.marketAddress)) {
    return NextResponse.json({ error: 'Valid marketAddress is required' }, { status: 400 });
  }
  if (body.action !== 'claim' && body.action !== 'refund') {
    return NextResponse.json({ error: 'action must be claim or refund' }, { status: 400 });
  }

  const market = (await fetchOnchainMarkets({ force: true }))
    .find((item) => item.id === body.marketAddress?.toLowerCase());
  if (!market) {
    return NextResponse.json({ error: 'marketAddress is not a legitimate factory-deployed Presto market' }, { status: 403 });
  }

  const requiredStatus = body.action === 'claim' ? 'Resolved' : 'Canceled';
  if (market.status !== requiredStatus) {
    return NextResponse.json(
      { error: `${body.action} is available only when market status is ${requiredStatus}. Current status: ${market.status}.` },
      { status: 409 },
    );
  }

  const result = await agentSettlePosition(body.marketAddress, body.action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    action: body.action,
    marketAddress: body.marketAddress,
    txHash: result.txHash,
    message: `Agent ${body.action} submitted on Arc Testnet.`,
  });
}
