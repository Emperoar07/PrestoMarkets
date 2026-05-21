import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { agentCreateMarket } from '@/lib/agentWallet';
import { sanitizeFeedText } from '@/lib/agentPipeline';
import type { AgentMarketMetadata } from '@/lib/marketMetadata';
import type { MarketType, ResolutionMode } from '@/lib/markets';

function cleanString(value: string | undefined): string | undefined {
  return value ? sanitizeFeedText(value) : value;
}

type AgentCreateMarketRequest = {
  type?: MarketType;
  title: string;
  description: string;
  category: string;
  closeDate?: string;
  closeInHours?: number;
  rules: string;
  sourceOfTruth: string;
  resolver?: string;
  resolutionMode?: ResolutionMode;
  imageURI?: string;
  agent?: Omit<AgentMarketMetadata, 'createdByType'>;
};

const DEFAULT_CLOSE_HOURS = 72;
const MIN_AGENT_SAFETY = Number(process.env.PRESTO_AGENT_MIN_SAFETY_SCORE ?? 70);
const MIN_AGENT_MOMENTUM = Number(process.env.PRESTO_AGENT_MIN_MOMENTUM_SCORE ?? 60);

function resolveCloseDate(input: AgentCreateMarketRequest): string {
  if (input.closeDate) return input.closeDate;
  const closeMs = Date.now() + Math.max(input.closeInHours ?? DEFAULT_CLOSE_HOURS, 1) * 3_600_000;
  return new Date(closeMs).toISOString();
}

function assertNonEmpty(value: string | undefined, label: string) {
  if (!value?.trim()) throw new Error(`${label} is required.`);
}

function assertAgentScores(agent: AgentCreateMarketRequest['agent']) {
  const safetyScore = Number(agent?.safetyScore);
  const momentumScore = Number(agent?.momentumScore);
  if (!Number.isFinite(safetyScore) || safetyScore < MIN_AGENT_SAFETY) {
    throw new Error(`Agent safetyScore must be at least ${MIN_AGENT_SAFETY}.`);
  }
  if (!Number.isFinite(momentumScore) || momentumScore < MIN_AGENT_MOMENTUM) {
    throw new Error(`Agent momentumScore must be at least ${MIN_AGENT_MOMENTUM}.`);
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  if (!validKey || apiKey !== validKey) {
    return NextResponse.json({ error: 'Unauthorized agent request' }, { status: 401 });
  }

  let body: AgentCreateMarketRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    assertNonEmpty(body.title, 'title');
    assertNonEmpty(body.description, 'description');
    assertNonEmpty(body.category, 'category');
    assertNonEmpty(body.rules, 'rules');
    assertNonEmpty(body.sourceOfTruth, 'sourceOfTruth');
    assertAgentScores(body.agent);

    // Always resolve to the agent wallet — never trust a caller-supplied resolver address.
    // A compromised API key must not be able to redirect resolution to an arbitrary address.
    const resolverAddress = process.env.PRESTO_AGENT_RESOLVER_ADDRESS
      ?? process.env.NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS
      ?? undefined; // agentCreateMarket will default to the agent wallet address

    if (resolverAddress && !isAddress(resolverAddress)) {
      throw new Error('PRESTO_AGENT_RESOLVER_ADDRESS must be a valid EVM address.');
    }

    const result = await agentCreateMarket({
      type: body.type ?? 'Prediction',
      // sanitizeFeedText strips prompt-injection sentinels from any caller-supplied string
      // that lands in onchain metadata and feeds into later LLM prompts (resolver evidence,
      // future pipeline runs that re-ingest existing markets).
      title: sanitizeFeedText(body.title.trim()),
      description: sanitizeFeedText(body.description.trim()),
      category: body.category.trim(),
      closeDate: resolveCloseDate(body),
      rules: sanitizeFeedText(body.rules.trim()),
      sourceOfTruth: sanitizeFeedText(body.sourceOfTruth.trim()),
      resolver: resolverAddress ?? 'Presto Agent',
      resolutionMode: body.resolutionMode ?? 'Agent assisted',
      imageURI: body.imageURI?.trim() || undefined,
      agent: {
        createdByType: 'agent',
        agentName: cleanString(body.agent?.agentName) ?? 'Presto Trend Agent',
        agentSource: cleanString(body.agent?.agentSource) ?? 'Trend monitor',
        agentModel: body.agent?.agentModel,
        agentReason: cleanString(body.agent?.agentReason),
        agentConfidence: body.agent?.agentConfidence,
        trendSource: cleanString(body.agent?.trendSource),
        trendUrl: body.agent?.trendUrl,
        momentumScore: body.agent?.momentumScore,
        safetyScore: body.agent?.safetyScore,
      },
      agentResolverAddress: resolverAddress,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      txHash: result.txHash,
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
      { status: 400 },
    );
  }
}
