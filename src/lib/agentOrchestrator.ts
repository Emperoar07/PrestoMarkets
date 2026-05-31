/**
 * Agent Orchestrator - Unified coordination of all 5 phases
 *
 * Flow:
 * 1. Queue receives market creation request
 * 2. Graph starts execution from checkpoint (pause/resume)
 * 3. Provider pool routes LLM calls with fallback
 * 4. 6-stage pipeline executes with clear separation
 * 5. Results flow back to queue + graph state
 *
 * This is the main entry point for autonomous agent execution.
 */

import { logger } from './logger';
import { enqueueRequest, dequeueRequest, markCompleted, markFailed, generateIdempotencyKey, type QueueRequest } from './agentQueue';
import { type GraphState } from './agentGraph';
import { ProviderPool } from './providers/pool';
import { AnthropicProvider } from './providers/anthropic';
import { runAgentPipeline, type PipelineResult, type TrendItem } from './agentPipeline';

// ── Initialize Provider Pool ────────────────────────────────────────────────

function initializeProviderPool(): ProviderPool {
  const providers = [
    new AnthropicProvider({
      name: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-opus-4-1',
      timeout: 30_000,
      maxRetries: 2,
    }),
    // Additional providers can be added here
    // new GroqProvider(...),
    // new GeminiProvider(...),
  ];

  return new ProviderPool(providers);
}

// ── Orchestrator State ──────────────────────────────────────────────────────

export type OrchestratorResult = {
  success: boolean;
  requestId: string;
  trend: {
    topic: string;
    source: string;
  };
  graphState: GraphState;
  pipelineResults: PipelineResult[];
  providerMetrics: any;
  duration: number;
  error?: string;
};

// ── Main Orchestration Function ────────────────────────────────────────────

export async function orchestrateMarketCreation(trend: TrendItem): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const requestId = generateIdempotencyKey(trend.topic, trend.source);

  logger.info('orchestrator', `Starting market creation orchestration: ${requestId}`, {
    topic: trend.topic,
    source: trend.source,
  });

  try {
    // Phase 1: Enqueue request (deduplication + durability)
    const queueRequest: QueueRequest = {
      id: requestId,
      trend: {
        topic: trend.topic,
        source: trend.source,
        url: trend.url,
      },
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries: 3,
    };

    const queueItem = enqueueRequest(queueRequest);
    logger.info('orchestrator', `Request enqueued`, { requestId });

    // Phase 2: Initialize provider pool for LLM calls
    const providerPool = initializeProviderPool();

    // Phase 3: Run the production pipeline against the requested trend.
    const pipelineResults = await runAgentPipeline({ trends: [trend] });
    const created = pipelineResults.find((result) => result.ok);
    const finalFailure = [...pipelineResults].reverse().find((result) => !result.ok);
    const graphState: GraphState = {
      graphId: requestId,
      startedAt: queueRequest.createdAt,
      currentNode: 'verify',
      trends: [trend],
      selectedTrend: created?.draft ? trend : undefined,
      draft: created?.draft,
      decision: created ? 'proceed' : 'reject',
      decisionReason: created ? undefined : finalFailure?.reason ?? 'No market was created by the production pipeline.',
      txHash: created?.txHash,
      verified: Boolean(created),
      verifiedAt: new Date().toISOString(),
    };

    const successfulStages = pipelineResults.filter(r => r.ok);
    const failedStages = pipelineResults.filter(r => !r.ok);

    logger.info('orchestrator', `Pipeline execution complete`, {
      created: successfulStages.length,
      refused: failedStages.length,
    });

    // Get provider metrics
    const providerMetrics = providerPool.getMetrics();

    // Mark request as completed
    markCompleted(requestId, {
      graphState,
      pipelineResults,
      providerMetrics,
    });

    const duration = Date.now() - startTime;

    logger.info('orchestrator', `Market creation completed successfully`, {
      requestId,
      duration,
      decision: graphState.decision,
    });

    return {
      success: true,
      requestId,
      trend: {
        topic: trend.topic,
        source: trend.source,
      },
      graphState,
      pipelineResults,
      providerMetrics,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('orchestrator', `Market creation failed`, {
      requestId,
      error: errorMessage,
      duration,
    });

    // Mark request as failed (will schedule retry)
    markFailed(requestId, errorMessage);

    return {
      success: false,
      requestId,
      trend: {
        topic: trend.topic,
        source: trend.source,
      },
      graphState: undefined as any,
      pipelineResults: [],
      providerMetrics: [],
      duration,
      error: errorMessage,
    };
  }
}

// ── Process Queue with Orchestrator ─────────────────────────────────────────

export async function processQueueItem(): Promise<OrchestratorResult | null> {
  const queueItem = dequeueRequest();

  if (!queueItem) {
    logger.debug('orchestrator', 'No pending queue items');
    return null;
  }

  logger.info('orchestrator', `Processing queue item: ${queueItem.id}`, {
    topic: queueItem.request.trend.topic,
  });

  try {
    const trend: TrendItem = {
      topic: queueItem.request.trend.topic,
      query: queueItem.request.trend.topic,
      source: queueItem.request.trend.source,
      url: queueItem.request.trend.url,
    };

    return await orchestrateMarketCreation(trend);
  } catch (error) {
    logger.error('orchestrator', `Failed to process queue item: ${queueItem.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });

    // Mark failed so queue handles retry logic
    markFailed(queueItem.id, error instanceof Error ? error.message : String(error));
    return null;
  }
}

// ── Batch Processing ────────────────────────────────────────────────────────

export async function processPendingQueue(limit: number = 5): Promise<OrchestratorResult[]> {
  const results: OrchestratorResult[] = [];

  logger.info('orchestrator', `Starting batch queue processing (limit: ${limit})`);

  for (let i = 0; i < limit; i++) {
    try {
      const result = await processQueueItem();
      if (result) {
        results.push(result);
      } else {
        // No more pending items
        break;
      }
    } catch (error) {
      logger.error('orchestrator', `Batch processing interrupted`, {
        error: error instanceof Error ? error.message : String(error),
        processedCount: results.length,
      });
      break;
    }
  }

  logger.info('orchestrator', `Batch queue processing complete`, {
    processed: results.length,
    successful: results.filter(r => r.success).length,
  });

  return results;
}

// ── Health Check ────────────────────────────────────────────────────────────

export type OrchestratorHealth = {
  status: 'healthy' | 'degraded' | 'error';
  providerHealth: Array<{ provider: string; status: string }>;
  queueDepth: number;
  timestamp: string;
};

export function getOrchestratorHealth(queueMetrics: any): OrchestratorHealth {
  const providerPool = initializeProviderPool();
  const metrics = providerPool.getMetrics();

  const providerHealth = metrics.map(m => ({
    provider: m.provider,
    status: m.failureCount === 0 ? 'healthy' : m.failureCount < 3 ? 'degraded' : 'error',
  }));

  const status =
    providerHealth.every(p => p.status === 'healthy') ? 'healthy' :
    providerHealth.some(p => p.status === 'error') ? 'error' :
    'degraded';

  return {
    status,
    providerHealth,
    queueDepth: queueMetrics.pending + queueMetrics.retrying,
    timestamp: new Date().toISOString(),
  };
}
