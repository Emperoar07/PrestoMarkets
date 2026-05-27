/**
 * Agent Queue API - Manage market creation request queue
 * Requires: Authorization header with bearer token matching MCP_AGENT_TOKEN
 *
 * Endpoints:
 * POST /api/agents/queue/enqueue - Add request to queue
 * POST /api/agents/queue/process - Process next pending request
 * GET /api/agents/queue/{requestId} - Get queue item status
 * GET /api/agents/queue - List all queue items
 * GET /api/agents/queue/metrics - Get queue metrics
 * POST /api/agents/queue/{requestId}/resubmit - Resubmit failed request
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  enqueueRequest,
  dequeueRequest,
  markCompleted,
  markFailed,
  getQueueItem,
  getQueueItems,
  getQueueMetrics,
  getDeadLetterQueue,
  resubmitDeadLetter,
  generateIdempotencyKey,
  type QueueRequest,
} from '@/lib/agentQueue';
import { logger } from '@/lib/logger';

// Authenticate using bearer token (constant-time comparison)
function authenticateRequest(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const token = process.env.MCP_AGENT_TOKEN;

  if (!token) {
    logger.error('agents-queue', 'MCP_AGENT_TOKEN not configured');
    return false;
  }

  const expected = `Bearer ${token}`;
  return auth.length === expected.length && Buffer.from(auth).equals(Buffer.from(expected));
}

// Enqueue a new market creation request
async function handleEnqueue(req: NextRequest) {
  try {
    const body = await req.json();
    const { trend, maxRetries = 3 } = body;

    if (!trend || !trend.topic || !trend.source) {
      return NextResponse.json(
        { error: 'Missing required fields: trend.topic, trend.source' },
        { status: 400 }
      );
    }

    const idempotencyKey = generateIdempotencyKey(trend.topic, trend.source);

    // Check if this request is already queued
    const existing = getQueueItem(idempotencyKey);
    if (existing) {
      return NextResponse.json({
        success: false,
        message: 'Request already queued',
        requestId: idempotencyKey,
        item: existing,
      });
    }

    const queueRequest: QueueRequest = {
      id: idempotencyKey,
      trend,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      maxRetries,
    };

    const item = enqueueRequest(queueRequest);

    return NextResponse.json({
      success: true,
      requestId: item.id,
      item,
    });
  } catch (error) {
    logger.error('agents-queue', 'Failed to enqueue request', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to enqueue request' },
      { status: 500 }
    );
  }
}

// Process next pending request
async function handleProcess() {
  try {
    const item = dequeueRequest();

    if (!item) {
      return NextResponse.json({
        success: false,
        message: 'No pending requests in queue',
      });
    }

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    logger.error('agents-queue', 'Failed to process queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to process queue' },
      { status: 500 }
    );
  }
}

// Get queue item by ID
async function handleGetItem(requestId: string) {
  try {
    const item = getQueueItem(requestId);

    if (!item) {
      return NextResponse.json(
        { error: 'Request not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    logger.error('agents-queue', `Failed to get queue item ${requestId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to retrieve queue item' },
      { status: 500 }
    );
  }
}

// List queue items
async function handleListItems(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get('state') as any;

    const items = getQueueItems(state);

    return NextResponse.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    logger.error('agents-queue', 'Failed to list queue items', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to list queue items' },
      { status: 500 }
    );
  }
}

// Get queue metrics
async function handleMetrics() {
  try {
    const metrics = getQueueMetrics();

    return NextResponse.json({
      success: true,
      metrics,
    });
  } catch (error) {
    logger.error('agents-queue', 'Failed to get queue metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to get queue metrics' },
      { status: 500 }
    );
  }
}

// Get dead letter queue
async function handleDeadLetterQueue() {
  try {
    const items = getDeadLetterQueue();

    return NextResponse.json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    logger.error('agents-queue', 'Failed to get dead letter queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to get dead letter queue' },
      { status: 500 }
    );
  }
}

// Resubmit a failed request
async function handleResubmit(requestId: string, req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { maxRetries = 3 } = body;

    const item = resubmitDeadLetter(requestId, maxRetries);

    if (!item) {
      return NextResponse.json(
        { error: 'Request not found or not in failed state' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      item,
    });
  } catch (error) {
    logger.error('agents-queue', `Failed to resubmit request ${requestId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to resubmit request' },
      { status: 500 }
    );
  }
}

// POST /api/agents/queue
export async function POST(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('agents-queue', 'Unauthorized POST request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const queueIndex = pathSegments.indexOf('queue');
  const action = pathSegments[queueIndex + 1];
  const requestId = pathSegments[queueIndex + 1];

  if (action === 'enqueue') {
    return handleEnqueue(req);
  } else if (action === 'process') {
    return handleProcess();
  } else if (action === 'resubmit' && requestId) {
    return handleResubmit(requestId, req);
  } else {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}

// GET /api/agents/queue
export async function GET(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('agents-queue', 'Unauthorized GET request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const queueIndex = pathSegments.indexOf('queue');
  const action = pathSegments[queueIndex + 1];

  if (action === 'metrics') {
    return handleMetrics();
  } else if (action === 'dead-letter') {
    return handleDeadLetterQueue();
  } else if (action) {
    return handleGetItem(action);
  } else {
    return handleListItems(req);
  }
}
