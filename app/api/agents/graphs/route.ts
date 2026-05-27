/**
 * Agent Graph API - Start, resume, and monitor graph execution
 * Requires: Authorization header with bearer token matching MCP_AGENT_TOKEN
 *
 * Endpoints:
 * POST /api/agents/graphs/start - Start new graph execution
 * POST /api/agents/graphs/{graphId}/resume - Resume from checkpoint
 * GET /api/agents/graphs/{graphId} - Get graph state
 * GET /api/agents/graphs/checkpoints - List active checkpoints
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAgentGraph, resumeAgentGraph, loadCheckpoint, listCheckpoints } from '@/lib/agentGraph';
import { logger } from '@/lib/logger';

// Authenticate using bearer token (constant-time comparison)
function authenticateRequest(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const token = process.env.MCP_AGENT_TOKEN;

  if (!token) {
    logger.error('agents-graphs', 'MCP_AGENT_TOKEN not configured');
    return false;
  }

  const expected = `Bearer ${token}`;
  return auth.length === expected.length && Buffer.from(auth).equals(Buffer.from(expected));
}

// Start a new graph execution
async function handleStart(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const state = await runAgentGraph(body);

    return NextResponse.json({
      success: true,
      graphId: state.graphId,
      state,
    });
  } catch (error) {
    logger.error('agents-graphs', 'Failed to start graph', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Graph execution failed' },
      { status: 500 }
    );
  }
}

// Resume a graph from checkpoint
async function handleResume(graphId: string) {
  try {
    const state = await resumeAgentGraph(graphId);

    return NextResponse.json({
      success: true,
      graphId,
      state,
    });
  } catch (error) {
    logger.error('agents-graphs', `Failed to resume graph ${graphId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Resume failed' },
      { status: 500 }
    );
  }
}

// Get graph state by ID
async function handleGetState(graphId: string) {
  try {
    const state = loadCheckpoint(graphId);

    if (!state) {
      return NextResponse.json(
        { error: 'Graph not found or checkpoint expired' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      graphId,
      state,
    });
  } catch (error) {
    logger.error('agents-graphs', `Failed to get graph state ${graphId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to retrieve graph state' },
      { status: 500 }
    );
  }
}

// List all active checkpoints
async function handleListCheckpoints() {
  try {
    const checkpoints = listCheckpoints();

    return NextResponse.json({
      success: true,
      count: checkpoints.length,
      checkpoints,
    });
  } catch (error) {
    logger.error('agents-graphs', 'Failed to list checkpoints', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to list checkpoints' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('agents-graphs', 'Unauthorized POST request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const isResume = pathSegments.includes('resume');
  const graphId = isResume ? pathSegments[pathSegments.indexOf('graphs') + 1] : null;

  if (isResume && graphId) {
    return handleResume(graphId);
  } else {
    return handleStart(req);
  }
}

export async function GET(req: NextRequest) {
  if (!authenticateRequest(req)) {
    logger.warn('agents-graphs', 'Unauthorized GET request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  const graphsIndex = pathSegments.indexOf('graphs');
  const graphId = pathSegments[graphsIndex + 1];
  const isCheckpoints = pathSegments[graphsIndex + 1] === 'checkpoints';

  if (isCheckpoints) {
    return handleListCheckpoints();
  } else if (graphId) {
    return handleGetState(graphId);
  } else {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
