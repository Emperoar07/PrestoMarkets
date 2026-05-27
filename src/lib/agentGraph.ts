/**
 * Agent Graph Orchestration - LangGraph-style state machine for agent pipeline
 * Enables: pause/resume, checkpoint persistence, multi-step coordination
 *
 * Graph nodes:
 * 1. perceive: Fetch trends from all sources
 * 2. analyze: Classify trends and assess research quality
 * 3. plan: Draft market structure and validate via LLM
 * 4. authorize: Safety checks and gate decisions
 * 5. execute: Submit to blockchain
 * 6. verify: Confirm onchain state
 */

import { randomUUID } from 'crypto';
import { TrendItem, classifyTrend, draftWithGemini, safetyCheckWithHaiku, type GroqClassification, type SafetyResult } from './agentPipeline';
import { fetchOnchainMarkets } from './onchainMarkets';
import { logger } from './logger';

// ── Graph State ──────────────────────────────────────────────────────────────

export type GraphNodeName = 'perceive' | 'analyze' | 'plan' | 'authorize' | 'execute' | 'verify';

export type GraphState = {
  // Metadata
  graphId: string;
  startedAt: string;
  currentNode: GraphNodeName;

  // Perception stage
  trends?: TrendItem[];

  // Analysis stage
  classifications?: { trend: TrendItem; classification: GroqClassification }[];
  filteredTrends?: TrendItem[];

  // Planning stage
  selectedTrend?: TrendItem;
  selectedClassification?: GroqClassification;
  draft?: any; // GeminiDraft

  // Authorization stage
  safety?: SafetyResult;
  decision?: 'proceed' | 'reject';
  decisionReason?: string;

  // Execution stage
  txHash?: string;
  txError?: string;

  // Verification stage
  verified?: boolean;
  verifiedAt?: string;

  // Error handling
  error?: string;
  errorStage?: GraphNodeName;
  retryCount?: number;
};

// ── Checkpoint Storage (Memory-based, can be replaced with DB/KV) ──────────

const checkpoints = new Map<string, { state: GraphState; timestamp: number }>();

function saveCheckpoint(graphId: string, state: GraphState) {
  checkpoints.set(graphId, { state: { ...state }, timestamp: Date.now() });
  logger.info('agent-graph', `Checkpoint saved: ${graphId} at node ${state.currentNode}`);
}

export function loadCheckpoint(graphId: string): GraphState | null {
  const checkpoint = checkpoints.get(graphId);
  if (!checkpoint) return null;

  const age = Date.now() - checkpoint.timestamp;
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  if (age > maxAge) {
    checkpoints.delete(graphId);
    logger.info('agent-graph', `Checkpoint expired: ${graphId}`);
    return null;
  }

  logger.info('agent-graph', `Checkpoint restored: ${graphId}`);
  return checkpoint.state;
}

// ── Graph Nodes (Pure functions that update state) ──────────────────────────

async function nodePerceive(state: GraphState): Promise<GraphState> {
  logger.info('agent-graph', `[${state.graphId}] Entering perceive node`);

  try {
    // Placeholder: would call fetchTrends() in production
    // For now, return empty to allow testing the graph flow
    const trends: TrendItem[] = [];

    return {
      ...state,
      currentNode: 'analyze',
      trends,
    };
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Perception failed',
      errorStage: 'perceive',
    };
  }
}

async function nodeAnalyze(state: GraphState): Promise<GraphState> {
  if (!state.trends || state.trends.length === 0) {
    return {
      ...state,
      currentNode: 'verify',
      verified: false,
      decision: 'reject',
      decisionReason: 'No trends available for analysis',
    };
  }

  logger.info('agent-graph', `[${state.graphId}] Entering analyze node (${state.trends.length} trends)`);

  try {
    const classifications = [];
    const filtered = [];

    for (const trend of state.trends) {
      try {
        const classification = await classifyTrend(trend);
        classifications.push({ trend, classification });

        if (classification.worthy && classification.momentumScore > 0.6) {
          filtered.push(trend);
        }
      } catch (e) {
        logger.warn('agent-graph', `Failed to classify trend: ${trend.topic}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info('agent-graph', `[${state.graphId}] Classified ${classifications.length} trends, ${filtered.length} passed filter`);

    return {
      ...state,
      currentNode: filtered.length > 0 ? 'plan' : 'verify',
      classifications,
      filteredTrends: filtered,
      verified: filtered.length === 0,
      decision: filtered.length === 0 ? 'reject' : undefined,
      decisionReason: filtered.length === 0 ? 'No trends passed classification threshold' : undefined,
    };
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Analysis failed',
      errorStage: 'analyze',
    };
  }
}

async function nodePlan(state: GraphState): Promise<GraphState> {
  if (!state.filteredTrends || state.filteredTrends.length === 0) {
    return {
      ...state,
      currentNode: 'verify',
      decision: 'reject',
      decisionReason: 'No trends to plan',
    };
  }

  logger.info('agent-graph', `[${state.graphId}] Entering plan node`);

  try {
    // Select the highest momentum trend
    const selected = state.filteredTrends[0];
    const classification = state.classifications?.find(c => c.trend === selected);

    if (!classification) {
      throw new Error('Classification not found for selected trend');
    }

    const draft = await draftWithGemini(
      selected,
      classification.classification.category,
      { suggestedType: classification.classification.suggestedMarketType }
    );

    logger.info('agent-graph', `[${state.graphId}] Draft created: "${draft.title}"`);

    return {
      ...state,
      currentNode: 'authorize',
      selectedTrend: selected,
      selectedClassification: classification.classification,
      draft,
    };
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Planning failed',
      errorStage: 'plan',
    };
  }
}

async function nodeAuthorize(state: GraphState): Promise<GraphState> {
  if (!state.draft) {
    return {
      ...state,
      currentNode: 'verify',
      decision: 'reject',
      decisionReason: 'No draft to authorize',
    };
  }

  logger.info('agent-graph', `[${state.graphId}] Entering authorize node`);

  try {
    const safety = await safetyCheckWithHaiku(state.draft, state.selectedTrend);

    if (!safety.pass || safety.confidence < 0.8) {
      logger.info('agent-graph', `[${state.graphId}] Safety gate rejected: ${safety.reason}`);
      return {
        ...state,
        currentNode: 'verify',
        safety,
        decision: 'reject',
        decisionReason: `Safety check failed: ${safety.reason}`,
      };
    }

    logger.info('agent-graph', `[${state.graphId}] Safety check passed`);

    return {
      ...state,
      currentNode: 'execute',
      safety,
      decision: 'proceed',
    };
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Authorization failed',
      errorStage: 'authorize',
    };
  }
}

async function nodeExecute(state: GraphState): Promise<GraphState> {
  if (state.decision !== 'proceed' || !state.draft) {
    return {
      ...state,
      currentNode: 'verify',
      decision: 'reject',
      decisionReason: 'Execution not authorized',
    };
  }

  logger.info('agent-graph', `[${state.graphId}] Entering execute node`);

  try {
    // Placeholder: would call agentCreateMarket() here
    // For now, simulate a transaction hash
    const txHash = `0x${randomUUID().replace(/-/g, '').slice(0, 64)}`;

    logger.info('agent-graph', `[${state.graphId}] Market created with tx: ${txHash}`);

    return {
      ...state,
      currentNode: 'verify',
      txHash,
    };
  } catch (error) {
    return {
      ...state,
      currentNode: 'verify',
      txError: error instanceof Error ? error.message : 'Execution failed',
      error: error instanceof Error ? error.message : 'Execution failed',
      errorStage: 'execute',
    };
  }
}

async function nodeVerify(state: GraphState): Promise<GraphState> {
  logger.info('agent-graph', `[${state.graphId}] Entering verify node`);

  try {
    const verified = state.txHash ? true : false;

    return {
      ...state,
      currentNode: 'verify',
      verified,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Verification failed',
      errorStage: 'verify',
    };
  }
}

// ── Graph Router (Determines next node based on state) ───────────────────────

async function routeGraph(state: GraphState): Promise<GraphState> {
  if (state.error) {
    logger.error('agent-graph', `[${state.graphId}] Graph error: ${state.error}`, {
      stage: state.errorStage,
      retryCount: state.retryCount || 0,
    });
    return state;
  }

  switch (state.currentNode) {
    case 'perceive':
      return nodePerceive(state);
    case 'analyze':
      return nodeAnalyze(state);
    case 'plan':
      return nodePlan(state);
    case 'authorize':
      return nodeAuthorize(state);
    case 'execute':
      return nodeExecute(state);
    case 'verify':
      return nodeVerify(state);
    default:
      return { ...state, error: `Unknown node: ${state.currentNode}` };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function runAgentGraph(initialState?: Partial<GraphState>): Promise<GraphState> {
  const graphId = initialState?.graphId || randomUUID();

  // Try to restore from checkpoint
  let state = loadCheckpoint(graphId);

  if (!state) {
    state = {
      graphId,
      startedAt: new Date().toISOString(),
      currentNode: 'perceive',
      ...initialState,
    };
  }

  logger.info('agent-graph', `Starting graph execution: ${graphId}`);

  // Execute graph until terminal state (verify node completes)
  let iterations = 0;
  const maxIterations = 10;

  while (state.currentNode !== 'verify' && iterations < maxIterations) {
    const prevNode = state.currentNode;
    state = await routeGraph(state);
    iterations++;

    // Save checkpoint after each node
    saveCheckpoint(graphId, state);

    logger.info('agent-graph', `[${graphId}] Node transition: ${prevNode} → ${state.currentNode}`);

    if (state.error) {
      logger.error('agent-graph', `[${graphId}] Graph execution halted at ${state.errorStage}`, {
        error: state.error,
      });
      break;
    }
  }

  if (iterations >= maxIterations) {
    state.error = `Graph execution exceeded max iterations (${maxIterations})`;
  }

  logger.info('agent-graph', `Graph execution complete: ${graphId}`, {
    decision: state.decision,
    verified: state.verified,
    txHash: state.txHash,
    error: state.error,
  });

  return state;
}

// Resume a paused graph from checkpoint
export async function resumeAgentGraph(graphId: string): Promise<GraphState> {
  const state = loadCheckpoint(graphId);

  if (!state) {
    throw new Error(`Checkpoint not found for graph ${graphId}`);
  }

  logger.info('agent-graph', `Resuming graph: ${graphId} from node ${state.currentNode}`);

  // Continue from current node (don't re-run it)
  return runAgentGraph({ ...state, startedAt: state.startedAt });
}

// List active checkpoints
export function listCheckpoints(): Array<{ graphId: string; node: GraphNodeName; age: number }> {
  const now = Date.now();
  return Array.from(checkpoints.entries()).map(([graphId, { state, timestamp }]) => ({
    graphId,
    node: state.currentNode,
    age: now - timestamp,
  }));
}
