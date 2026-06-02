import { NextRequest, NextResponse } from 'next/server';
import { agentCreateMarket } from '@/lib/agentWallet';
import { verifyApiKey } from '@/lib/authCompare';
import {
  AgentMarketValidationError,
  prepareAgentCreateMarketInput,
  type AgentCreateMarketRequest,
} from '@/lib/agentMarketValidation';

const DEFAULT_CLOSE_HOURS = 72;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (!verifyApiKey(apiKey, process.env.PRESTO_AGENT_API_KEY)) {
    return NextResponse.json({ error: 'Unauthorized agent request' }, { status: 401 });
  }

  let body: AgentCreateMarketRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const input = await prepareAgentCreateMarketInput(body, {
      defaultCloseHours: DEFAULT_CLOSE_HOURS,
      defaultAgent: {
        agentName: 'Presto Trend Agent',
        agentSource: 'Trend monitor',
      },
    });
    const result = await agentCreateMarket(input);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      txHash: result.txHash,
      marketAddress: result.marketAddress,
      resolverAddress: result.resolverAddress,
      createdByType: 'agent',
      agent: {
        name: body.agent?.agentName ?? 'Presto Trend Agent',
        source: body.agent?.agentSource ?? 'Trend monitor',
        confidence: body.agent?.agentConfidence,
        momentumScore: body.agent?.momentumScore,
        safetyScore: body.agent?.safetyScore,
      },
      message: 'Agent-created market submitted to Arc.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Agent market creation failed.' },
      { status: error instanceof AgentMarketValidationError ? error.status : 400 },
    );
  }
}
