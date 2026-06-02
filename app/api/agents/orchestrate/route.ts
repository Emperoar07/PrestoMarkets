/**
 * Agent Orchestrator API - Main entry point for agent execution
 *
 * Endpoints:
 * POST /api/agents/orchestrate - Trigger market creation from trend
 * POST /api/agents/orchestrate/process-queue - Process pending queue items
 * GET /api/agents/orchestrate/health - Check orchestrator health
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  orchestrateMarketCreation,
  processQueueItem,
  processPendingQueue,
  getOrchestratorHealth,
} from '@/lib/agentOrchestrator';
import { getQueueMetrics } from '@/lib/agentQueue';
import { logger } from '@/lib/logger';
import { verifyBearer } from '@/lib/authCompare';
import type { TrendItem } from '@/lib/agentPipeline';

// Authenticate using bearer token
function authenticateRequest(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const token = process.env.MCP_AGENT_TOKEN;

  if (!token) {
    logger.error('orchestrate', 'MCP_AGENT_TOKEN not configured');
    return false;
  }

  return verifyBearer(auth, token);
}

// Trigger orchestration for a specific trend
async function handleOrchestrate(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, source, url, query } = body;

    if (!topic || !source) {
      return NextResponse.json(
        { error: 'Missing required fields: topic, source' },
        { status: 400 }
      );
    }

    const trend: TrendItem = {
      topic,
      query: query || topic,
      source,
      url,
    };

    const result = await orchestrateMarketCreation(trend);

    return NextResponse.json({
      success: result.success,
      requestId: result.requestId,
      result,
    });
  } catch (error) {
    logger.error('orchestrate', 'Failed to orchestrate market creation', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to orchestrate market creation' },
      { status: 500 }
    );
  }
}

// Process one pending queue item
async function handleProcessOne() {
  try {
    const result = await processQueueItem();

    if (!result) {
      return NextResponse.json({
        success: true,
        message: 'No pending items in queue',
      });
    }

    return NextResponse.json({
      success: result.success,
      requestId: result.requestId,
      result,
    });
  } catch (error) {
    logger.error('orchestrate', 'Failed to process queue item', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to process queue item' },
      { status: 500 }
    );
  }
}

// Process multiple pending queue items
async function handleProcessQueue(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      parseInt(url.searchParams.get('limit') || '5'),
      50 // Cap at 50 to prevent abuse
    );

    const results = await processPendingQueue(limit);

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      results,
    });
  } catch (error) {
    logger.error('orchestrate', 'Failed to process queue batch', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to process queue batch' },
      { status: 500 }
    );
  }
}

// Check orchestrator health
async function handleHealth() {
  try {
    const metrics = getQueueMetrics();
    const health = getOrchestratorHealth(metrics);

    return NextResponse.json({
      success: true,
      health,
      queueMetrics: metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('orchestrate', 'Failed to get health status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to get health status' },
      { status: 500 }
    );
  }
}

function getRouteAction(req: NextRequest) {
  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const orchestrateIndex = pathSegments.indexOf('orchestrate');
  return url.searchParams.get('action')?.trim() ?? pathSegments[orchestrateIndex + 1];
}

// POST /api/agents/orchestrate
export async function POST(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('orchestrate', 'Unauthorized POST request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = getRouteAction(req);

  if (action === 'process-queue') {
    return handleProcessQueue(req);
  } else if (action === 'process-one') {
    return handleProcessOne();
  } else {
    return handleOrchestrate(req);
  }
}

// GET /api/agents/orchestrate
export async function GET(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('orchestrate', 'Unauthorized GET request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = getRouteAction(req);

  if (action === 'health') {
    return handleHealth();
  } else {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
