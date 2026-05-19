/**
 * Agent ERC-8004 identity endpoint.
 *
 * GET  /api/agents/identity  — returns agent address + registration status
 * POST /api/agents/identity  — triggers ERC-8004 registration (PRESTO_AGENT_API_KEY required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentIdentityStatus, registerAgentIdentity, ERC8004_CONTRACTS } from '@/lib/agentIdentity';
import { getAgentAddress } from '@/lib/agentWallet';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  const agentAddress = getAgentAddress();
  if (!agentAddress) {
    return NextResponse.json({ ok: false, error: 'AGENT_PRIVATE_KEY not set' }, { status: 500 });
  }

  try {
    const status = await getAgentIdentityStatus();
    return NextResponse.json({
      ok: true,
      agent: {
        address: status.agentAddress,
        registered: status.registered,
        agentId: status.agentId,
        metadataURI: status.metadataURI,
        contracts: {
          identityRegistry: ERC8004_CONTRACTS.IdentityRegistry,
          reputationRegistry: ERC8004_CONTRACTS.ReputationRegistry,
          validationRegistry: ERC8004_CONTRACTS.ValidationRegistry,
        },
        explorerUrl: status.agentId
          ? `https://testnet.arcscan.app/token/${ERC8004_CONTRACTS.IdentityRegistry}/instance/${status.agentId}`
          : null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Identity check failed' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  if (!validKey || apiKey !== validKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await registerAgentIdentity();
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      agentId: result.agentId,
      txHash: result.txHash,
      note: result.txHash === '0x0'
        ? 'Agent was already registered — no new transaction needed.'
        : `Agent registered on ERC-8004. Save AGENT_ERC8004_ID=${result.agentId} to your environment.`,
      explorerUrl: result.txHash !== '0x0'
        ? `https://testnet.arcscan.app/tx/${result.txHash}`
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Registration failed' },
      { status: 500 },
    );
  }
}
