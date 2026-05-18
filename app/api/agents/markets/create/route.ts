import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcChainId, getArcConfig } from '@/lib/arcConfig';
import { prestoMarketFactoryAbi } from '@/lib/contracts';
import { buildMarketMetadataURI, type AgentMarketMetadata } from '@/lib/marketMetadata';
import type { MarketType, ResolutionMode } from '@/lib/markets';

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

function getMarketKind(type: MarketType) {
  if (type === 'Opinion') return 1;
  if (type === 'Opportunity') return 2;
  return 0;
}

function getCloseTimestamp(input: AgentCreateMarketRequest) {
  const closeMs = input.closeDate
    ? new Date(input.closeDate).getTime()
    : Date.now() + Math.max(input.closeInHours ?? DEFAULT_CLOSE_HOURS, 1) * 3_600_000;

  if (!Number.isFinite(closeMs) || closeMs <= Date.now()) {
    throw new Error('Agent market close time must be in the future.');
  }

  return BigInt(Math.floor(closeMs / 1000));
}

function getAgentPrivateKey() {
  const raw = process.env.PRESTO_AGENT_PRIVATE_KEY ?? process.env.AGENT_ADMIN_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? '';
  if (!raw.trim()) throw new Error('PRESTO_AGENT_PRIVATE_KEY is required for agent market creation.');
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
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

    const config = getArcConfig();
    if (!config.rpcUrl) throw new Error('NEXT_PUBLIC_ARC_RPC_URL or ARC_RPC_URL is required.');
    if (!config.factoryAddress || !isAddress(config.factoryAddress)) {
      throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS must be configured.');
    }

    const resolver = body.resolver ?? process.env.PRESTO_AGENT_RESOLVER_ADDRESS ?? process.env.NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS ?? '';
    if (!isAddress(resolver)) throw new Error('resolver or PRESTO_AGENT_RESOLVER_ADDRESS must be a valid address.');

    const account = privateKeyToAccount(getAgentPrivateKey());
    const chain = {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    };
    const transport = http(config.rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const type = body.type ?? 'Prediction';
    const metadataURI = buildMarketMetadataURI({
      type,
      title: body.title.trim(),
      description: body.description.trim(),
      category: body.category.trim(),
      rules: body.rules.trim(),
      sourceOfTruth: body.sourceOfTruth.trim(),
      resolutionMode: body.resolutionMode ?? 'Agent assisted',
      imageURI: body.imageURI?.trim() || undefined,
      agent: {
        createdByType: 'agent',
        agentName: body.agent?.agentName ?? 'Presto Trend Agent',
        agentSource: body.agent?.agentSource ?? 'X/Grok trend monitor',
        agentModel: body.agent?.agentModel,
        agentReason: body.agent?.agentReason,
        agentConfidence: body.agent?.agentConfidence,
        trendSource: body.agent?.trendSource,
        trendUrl: body.agent?.trendUrl,
        momentumScore: body.agent?.momentumScore,
        safetyScore: body.agent?.safetyScore,
      },
    });

    const hash = await walletClient.writeContract({
      account,
      address: config.factoryAddress as Address,
      abi: prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: [
        resolver as Address,
        getCloseTimestamp(body),
        metadataURI,
        getMarketKind(type),
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({
      ok: true,
      txHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      createdByType: 'agent',
      agent: {
        name: body.agent?.agentName ?? 'Presto Trend Agent',
        source: body.agent?.agentSource ?? 'X/Grok trend monitor',
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
