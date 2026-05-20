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

    const alreadyRegistered = result.txHash === '0x0';

    // Auto-persist AGENT_ERC8004_ID to Vercel env vars if token is configured.
    // VERCEL_TOKEN is high-value: a single bug here that bubbles up the Vercel response body
    // could leak it. Gate the value strictly (numeric IDs only) and never echo Vercel error
    // bodies back to the caller.
    let vercelEnvSet = false;
    const vercelToken = process.env.VERCEL_TOKEN;
    const vercelProjectId = process.env.VERCEL_PROJECT_ID ?? 'prj_MRjpZNy9yykIfO3c4wX344tIldWA';
    const agentIdIsNumeric = typeof result.agentId === 'string' && /^\d+$/.test(result.agentId);
    if (vercelToken && agentIdIsNumeric) {
      try {
        const body = JSON.stringify({ key: 'AGENT_ERC8004_ID', value: result.agentId, type: 'plain', target: ['production', 'preview'] });
        const headers = { 'Authorization': `Bearer ${vercelToken}`, 'Content-Type': 'application/json' };
        const res = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env`, { method: 'POST', headers, body });
        if (res.ok) {
          vercelEnvSet = true;
        } else if (res.status === 409) {
          const existing = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env?keys=AGENT_ERC8004_ID`, { headers });
          const data = await existing.json().catch(() => ({})) as { envs?: Array<{ id: string }> };
          const envId = data.envs?.[0]?.id;
          if (envId) {
            const patch = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env/${envId}`, {
              method: 'PATCH', headers, body: JSON.stringify({ value: result.agentId }),
            });
            vercelEnvSet = patch.ok;
          }
        }
      } catch {
        // Swallow without logging — error bodies from Vercel can contain the bearer token.
      }
    }

    return NextResponse.json({
      ok: true,
      agentId: result.agentId,
      txHash: result.txHash,
      vercelEnvSet,
      note: alreadyRegistered
        ? 'Agent was already registered — no new transaction needed.'
        : vercelEnvSet
          ? `Agent registered on ERC-8004. AGENT_ERC8004_ID=${result.agentId} has been set in Vercel automatically.`
          : `Agent registered on ERC-8004. Manually add AGENT_ERC8004_ID=${result.agentId} to your environment.`,
      explorerUrl: !alreadyRegistered
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
