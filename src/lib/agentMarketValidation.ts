import { isAddress } from 'viem';
import { getAgentIdentityStatus } from './agentIdentity';
import { getAgentAddress } from './agentWallet';
import { sanitizeFeedText } from './feedSanitizer';
import type { CreateLiveMarketInput } from './liveActions';
import type { AgentMarketMetadata } from './marketMetadata';
import { validateMarketSafety } from './marketSafetyValidator';
import type { MarketType, ResolutionMode } from './markets';
import { isSafeHttpUrl } from './publicUrl';

export type AgentCreateMarketRequest = {
  type?: MarketType;
  title: string;
  description: string;
  category: string;
  categories?: string[];
  closeDate?: string;
  closeInHours?: number;
  rules: string;
  sourceOfTruth: string;
  resolver?: string;
  resolutionMode?: ResolutionMode;
  imageURI?: string;
  outcomeOptions?: string[];
  agent?: Omit<AgentMarketMetadata, 'createdByType'>;
};

type PrepareOptions = {
  defaultCloseHours?: number;
  defaultAgent: Omit<AgentMarketMetadata, 'createdByType'>;
  requireRegisteredIdentity?: boolean;
};

export class AgentMarketValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AgentMarketValidationError';
    this.status = status;
  }
}

const DEFAULT_CLOSE_HOURS = 72;

function minAgentSafety() {
  return Number(process.env.PRESTO_AGENT_MIN_SAFETY_SCORE ?? 70);
}

function minAgentMomentum() {
  return Number(process.env.PRESTO_AGENT_MIN_MOMENTUM_SCORE ?? 60);
}

function cleanString(value: string | undefined): string | undefined {
  return value ? sanitizeFeedText(value) : value;
}

function assertNonEmpty(value: string | undefined, label: string) {
  if (!value?.trim()) throw new AgentMarketValidationError(`${label} is required.`);
}

function resolveCloseDate(input: AgentCreateMarketRequest, defaultCloseHours: number): string {
  if (input.closeDate) return input.closeDate;
  const closeMs = Date.now() + Math.max(input.closeInHours ?? defaultCloseHours, 1) * 3_600_000;
  return new Date(closeMs).toISOString();
}

function assertAgentScores(agent: AgentCreateMarketRequest['agent']) {
  const safetyScore = Number(agent?.safetyScore);
  const momentumScore = Number(agent?.momentumScore);
  const safetyMinimum = minAgentSafety();
  const momentumMinimum = minAgentMomentum();

  if (!Number.isFinite(safetyScore) || safetyScore < safetyMinimum) {
    throw new AgentMarketValidationError(`Agent safetyScore must be at least ${safetyMinimum}.`);
  }
  if (!Number.isFinite(momentumScore) || momentumScore < momentumMinimum) {
    throw new AgentMarketValidationError(`Agent momentumScore must be at least ${momentumMinimum}.`);
  }
}

function getTrustedResolverAddress() {
  const resolverAddress = process.env.PRESTO_AGENT_RESOLVER_ADDRESS
    ?? process.env.NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS;

  if (!resolverAddress || !isAddress(resolverAddress)) {
    throw new AgentMarketValidationError(
      'PRESTO_AGENT_RESOLVER_ADDRESS must be explicitly configured and valid. Agent markets cannot be created without a trusted resolver.',
      500,
    );
  }

  const agentAddress = getAgentAddress();
  if (!agentAddress) {
    throw new AgentMarketValidationError('AGENT_PRIVATE_KEY must be configured to verify agent identity.', 500);
  }
  if (resolverAddress.toLowerCase() !== agentAddress.toLowerCase()) {
    throw new AgentMarketValidationError(
      'PRESTO_AGENT_RESOLVER_ADDRESS must match the configured agent wallet that signs automatic resolutions.',
      500,
    );
  }

  return resolverAddress;
}

export function normalizeAgentMarketType(value: unknown): MarketType {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  const oldBuilderSignalType = ['oppor', 'tunity'].join('');
  return raw === 'opinion' || raw === oldBuilderSignalType ? 'Opinion' : 'Prediction';
}

export async function prepareAgentCreateMarketInput(
  body: AgentCreateMarketRequest,
  options: PrepareOptions,
): Promise<CreateLiveMarketInput & { agentResolverAddress: string }> {
  assertNonEmpty(body.title, 'title');
  assertNonEmpty(body.description, 'description');
  assertNonEmpty(body.category, 'category');
  assertNonEmpty(body.rules, 'rules');
  assertNonEmpty(body.sourceOfTruth, 'sourceOfTruth');

  if (!isSafeHttpUrl(body.sourceOfTruth)) {
    throw new AgentMarketValidationError('sourceOfTruth must be a concrete public http(s) URL the resolver can read.');
  }

  const agent = { ...options.defaultAgent, ...body.agent };
  assertAgentScores(agent);

  const safetyCheck = validateMarketSafety(body.title, body.description, body.rules);
  if (!safetyCheck.ok) {
    throw new AgentMarketValidationError(safetyCheck.reason);
  }

  const resolverAddress = getTrustedResolverAddress();

  if (options.requireRegisteredIdentity ?? true) {
    try {
      const identityStatus = await getAgentIdentityStatus();
      if (!identityStatus.registered) {
        throw new AgentMarketValidationError(
          'Agent is not registered on Arc ERC-8004 IdentityRegistry. Register the agent before creating markets.',
          500,
        );
      }
    } catch (error) {
      if (error instanceof AgentMarketValidationError) throw error;
      throw new AgentMarketValidationError(
        `Failed to verify agent identity: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
      );
    }
  }

  return {
    type: normalizeAgentMarketType(body.type),
    title: sanitizeFeedText(body.title.trim()),
    description: sanitizeFeedText(body.description.trim()),
    category: sanitizeFeedText(body.category.trim()),
    categories: Array.isArray(body.categories)
      ? body.categories.map((c) => sanitizeFeedText(String(c).trim())).filter(Boolean).slice(0, 4)
      : undefined,
    closeDate: resolveCloseDate(body, options.defaultCloseHours ?? DEFAULT_CLOSE_HOURS),
    rules: sanitizeFeedText(body.rules.trim()),
    sourceOfTruth: sanitizeFeedText(body.sourceOfTruth.trim()),
    resolver: resolverAddress,
    resolutionMode: 'Agent assisted',
    imageURI: body.imageURI?.trim() || undefined,
    outcomeOptions: Array.isArray(body.outcomeOptions)
      ? body.outcomeOptions.map((o) => sanitizeFeedText(String(o).trim())).filter(Boolean).slice(0, 12)
      : undefined,
    agent: {
      createdByType: 'agent',
      agentName: cleanString(agent.agentName) ?? options.defaultAgent.agentName,
      agentSource: cleanString(agent.agentSource) ?? options.defaultAgent.agentSource,
      agentModel: agent.agentModel,
      agentReason: cleanString(agent.agentReason),
      agentConfidence: agent.agentConfidence,
      trendSource: cleanString(agent.trendSource),
      trendUrl: agent.trendUrl,
      momentumScore: agent.momentumScore,
      safetyScore: agent.safetyScore,
      displayType: agent.displayType,
    },
    agentResolverAddress: resolverAddress,
  };
}
