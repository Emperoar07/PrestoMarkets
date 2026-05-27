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

import { TrendItem, GroqClassification, SafetyResult } from './agentPipeline';
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
    // Placeholder: would fetch from all sources
    const trends: TrendItem[] = [];

    return {
      trends,
      sourceCount: 0,
      timestamp: new Date().toISOString(),
    };
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
      // Placeholder: would classify trend
      // const classification = await classifyTrend(trend);
      // if (classification.worthy && classification.momentumScore > 0.6) {
      //   filtered.push(trend);
      // }
      // scored.push({ trend, classification });
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
    // Placeholder: would call draftWithGemini
    const output: PlanOutput = {
      title: `Will ${input.trend.topic}?`,
      description: `News: ${input.trend.topic}`,
      rules: 'YES wins if the event occurs by the close date. NO wins if it does not occur or remains unresolved.',
      sourceOfTruth: input.trend.url || 'Public sources',
      closeDate: input.trend.closeDate || new Date().toISOString().split('T')[0],
      type: input.classification.suggestedMarketType || 'Prediction',
      timestamp: new Date().toISOString(),
    };

    logger.info('agent-stages', `Stage 3: Plan complete`, {
      duration: Date.now() - startTime,
      title: output.title,
    });

    return output;
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
    // Placeholder: would call safetyCheckWithHaiku
    const output: AuthorizeOutput = {
      passed: true,
      reason: 'Market passes safety checks',
      safetyScore: 85,
      timestamp: new Date().toISOString(),
    };

    logger.info('agent-stages', `Stage 4: Authorize ${output.passed ? 'approved' : 'rejected'}`, {
      duration: Date.now() - startTime,
      reason: output.reason,
    });

    return output;
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
    // Placeholder: would call agentCreateMarket
    const output: ExecuteOutput = {
      txHash: `0x${'0'.repeat(64)}`,
      timestamp: new Date().toISOString(),
    };

    logger.info('agent-stages', `Stage 5: Execute complete`, {
      duration: Date.now() - startTime,
      txHash: output.txHash.slice(0, 10),
    });

    return output;
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
    // Placeholder: would verify transaction and extract market address
    const output: VerifyOutput = {
      confirmed: true,
      marketAddress: `0x${'0'.repeat(40)}`,
      blockNumber: 0,
      timestamp: new Date().toISOString(),
    };

    logger.info('agent-stages', `Stage 6: Verify complete`, {
      duration: Date.now() - startTime,
      confirmed: output.confirmed,
    });

    return output;
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

export async function runStagedPipeline(): Promise<PipelineResult[]> {
  const startTime = Date.now();
  const results: PipelineResult[] = [];

  try {
    // Stage 1: Perceive
    const perceiveOutput = await stagePerceive({});
    results.push({
      success: true,
      stage: 'perceive',
      output: perceiveOutput,
      duration: Date.now() - startTime,
    });

    if (perceiveOutput.trends.length === 0) {
      throw new Error('No trends available');
    }

    // Stage 2: Analyze
    const analyzeOutput = await stageAnalyze({ trends: perceiveOutput.trends });
    results.push({
      success: true,
      stage: 'analyze',
      output: analyzeOutput,
      duration: Date.now() - startTime,
    });

    if (analyzeOutput.filtered.length === 0) {
      throw new Error('No trends passed analysis');
    }

    // Stage 3: Plan
    const planOutput = await stagePlan({
      trend: analyzeOutput.filtered[0],
      category: 'General',
      classification: analyzeOutput.scored[0].classification,
    });
    results.push({
      success: true,
      stage: 'plan',
      output: planOutput,
      duration: Date.now() - startTime,
    });

    // Stage 4: Authorize
    const authorizeOutput = await stageAuthorize({ plan: planOutput });
    results.push({
      success: true,
      stage: 'authorize',
      output: authorizeOutput,
      duration: Date.now() - startTime,
    });

    if (!authorizeOutput.passed) {
      throw new Error(`Authorization failed: ${authorizeOutput.reason}`);
    }

    // Stage 5: Execute
    const executeOutput = await stageExecute({
      plan: planOutput,
      authorization: authorizeOutput,
      trendSource: analyzeOutput.filtered[0].source,
    });
    results.push({
      success: true,
      stage: 'execute',
      output: executeOutput,
      duration: Date.now() - startTime,
    });

    // Stage 6: Verify
    const verifyOutput = await stageVerify({ execution: executeOutput });
    results.push({
      success: true,
      stage: 'verify',
      output: verifyOutput,
      duration: Date.now() - startTime,
    });

    logger.info('agent-stages', 'Pipeline completed successfully', {
      duration: Date.now() - startTime,
    });
  } catch (error) {
    const stage = error instanceof Error ? error.message.split(':')[0] : 'unknown';
    results.push({
      success: false,
      stage,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });

    logger.error('agent-stages', 'Pipeline failed', {
      stage,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    });
  }

  return results;
}
