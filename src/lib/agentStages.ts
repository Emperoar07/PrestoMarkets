/**
 * Agent Pipeline Stages - Explicit 6-stage separation of concerns
 *
 * Each stage has:
 * - Clear input contract (required fields)
 * - Clear output contract (return type)
 * - Isolated error handling
 * - Metrics and logging
 *
 * Stages:
 * 1. Perceive: Fetch trends from all sources
 * 2. Analyze: Classify trends and assess research quality
 * 3. Plan: Draft market structure using LLM
 * 4. Authorize: Safety checks and gate decisions
 * 5. Execute: Submit to blockchain
 * 6. Verify: Confirm onchain state and settle
 */

import { runAgentPipeline, TrendItem, GroqClassification, SafetyResult } from './agentPipeline';
import { logger } from './logger';

// ── Stage 1: Perceive ────────────────────────────────────────────────────────

export type PerceiveInput = Record<string, never>; // No input

export type PerceiveOutput = {
  trends: TrendItem[];
  sourceCount: number;
  timestamp: string;
};

export async function stagePerceive(_input: PerceiveInput): Promise<PerceiveOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', 'Stage 1: Perceive - fetching trends');

  try {
    throw new Error('Standalone staged perception is disabled. Use runStagedPipeline({ trends }) or runAgentPipeline().');
  } catch (error) {
    logger.error('agent-stages', 'Stage 1 failed: Perceive', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

// ── Stage 2: Analyze ─────────────────────────────────────────────────────────

export type AnalyzeInput = {
  trends: TrendItem[];
};

export type AnalyzeOutput = {
  scored: Array<{ trend: TrendItem; classification: GroqClassification }>;
  filtered: TrendItem[];
  passCount: number;
  failCount: number;
  timestamp: string;
};

export async function stageAnalyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', `Stage 2: Analyze - ${input.trends.length} trends`);

  const scored: Array<{ trend: TrendItem; classification: GroqClassification }> = [];
  const filtered: TrendItem[] = [];

  for (const trend of input.trends) {
    try {
      throw new Error(`Standalone staged analysis is disabled for "${trend.topic}". Use runAgentPipeline() for live classification.`);
    } catch (error) {
      logger.warn('agent-stages', `Failed to classify: ${trend.topic}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('agent-stages', `Stage 2: Analyze complete - ${filtered.length} passed`, {
    duration: Date.now() - startTime,
  });

  return {
    scored,
    filtered,
    passCount: filtered.length,
    failCount: input.trends.length - filtered.length,
    timestamp: new Date().toISOString(),
  };
}

// ── Stage 3: Plan ────────────────────────────────────────────────────────────

export type PlanInput = {
  trend: TrendItem;
  category: string;
  classification: GroqClassification;
};

export type PlanOutput = {
  title: string;
  description: string;
  rules: string;
  sourceOfTruth: string;
  closeDate: string;
  type: string;
  timestamp: string;
};

export async function stagePlan(input: PlanInput): Promise<PlanOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', `Stage 3: Plan - drafting market for "${input.trend.topic}"`);

  try {
    throw new Error(`Standalone staged planning is disabled for "${input.trend.topic}". Use runAgentPipeline() for live drafting.`);
  } catch (error) {
    logger.error('agent-stages', 'Stage 3 failed: Plan', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

// ── Stage 4: Authorize ───────────────────────────────────────────────────────

export type AuthorizeInput = {
  plan: PlanOutput;
  trend?: TrendItem;
};

export type AuthorizeOutput = {
  passed: boolean;
  reason: string;
  safetyScore: number;
  timestamp: string;
};

export async function stageAuthorize(input: AuthorizeInput): Promise<AuthorizeOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', `Stage 4: Authorize - checking safety`);

  try {
    throw new Error(`Standalone staged authorization is disabled for "${input.plan.title}". Use runAgentPipeline() for live safety checks.`);
  } catch (error) {
    logger.error('agent-stages', 'Stage 4 failed: Authorize', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

// ── Stage 5: Execute ─────────────────────────────────────────────────────────

export type ExecuteInput = {
  plan: PlanOutput;
  authorization: AuthorizeOutput;
  trendSource: string;
};

export type ExecuteOutput = {
  txHash: string;
  marketAddress?: string;
  blockNumber?: number;
  timestamp: string;
};

export async function stageExecute(input: ExecuteInput): Promise<ExecuteOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', `Stage 5: Execute - deploying market`);

  if (!input.authorization.passed) {
    throw new Error('Cannot execute without authorization');
  }

  try {
    throw new Error(`Standalone staged execution is disabled for "${input.plan.title}". Use runAgentPipeline() for live onchain execution.`);
  } catch (error) {
    logger.error('agent-stages', 'Stage 5 failed: Execute', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

// ── Stage 6: Verify ─────────────────────────────────────────────────────────

export type VerifyInput = {
  execution: ExecuteOutput;
};

export type VerifyOutput = {
  confirmed: boolean;
  marketAddress: string;
  blockNumber: number;
  timestamp: string;
};

export async function stageVerify(input: VerifyInput): Promise<VerifyOutput> {
  const startTime = Date.now();
  logger.info('agent-stages', `Stage 6: Verify - confirming onchain state`);

  try {
    throw new Error(`Standalone staged verification is disabled for "${input.execution.txHash}". Use runAgentPipeline() for live verification.`);
  } catch (error) {
    logger.error('agent-stages', 'Stage 6 failed: Verify', {
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
    throw error;
  }
}

// ── Pipeline Coordinator ─────────────────────────────────────────────────────

export type PipelineResult = {
  success: boolean;
  stage: string;
  output?: any;
  error?: string;
  duration: number;
};

export async function runStagedPipeline(input: { trends?: TrendItem[] } = {}): Promise<PipelineResult[]> {
  const startTime = Date.now();
  const results = await runAgentPipeline(input);
  return results.map((result) => ({
    success: result.ok,
    stage: result.ok ? 'execute' : result.stage,
    output: result.ok ? result : undefined,
    error: result.ok ? undefined : result.reason,
    duration: Date.now() - startTime,
  }));
}
