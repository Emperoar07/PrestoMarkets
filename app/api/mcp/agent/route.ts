/**
 * Model Context Protocol (MCP) endpoint for Presto agent
 * Exposes agent capabilities via standard MCP interface
 *
 * Usage:
 * - MCPClient(uri="http://presto-markets.vercel.app/api/mcp/agent")
 * - Tools available: fetch_trends, classify_trend, draft_market, validate_market, create_market, resolve_market
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  MCP_TOOLS,
  MCP_RESOURCES,
  agentStatusResource,
  type AgentStatus,
  type TrendResponse,
  type ValidationResponse,
  type MarketCreationResponse,
  type ResolutionResponse,
} from '@/lib/agentMcp';
import { fetchTrends, classifyTrend, draftWithGemini, safetyCheckWithHaiku, type TrendItem } from '@/lib/agentPipeline';
import { agentCreateMarket } from '@/lib/agentWallet';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { logger } from '@/lib/logger';

/**
 * MCP Resource Handler - returns available resources and their metadata
 */
async function handleResourcesList(): Promise<any> {
  return {
    resources: MCP_RESOURCES.map(r => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  };
}

/**
 * MCP Resource Handler - returns specific resource content
 */
async function handleResourceRead(uri: string): Promise<any> {
  if (uri === agentStatusResource.uri) {
    const markets = await fetchOnchainMarkets().catch(() => []);
    const agentMarkets = markets.filter(m => m.agentReason);

    const status: AgentStatus = {
      status: 'ready',
      activeMarkets: agentMarkets.filter(m => m.status === 'Open').length,
      totalCreated: agentMarkets.length,
      lastMarketTime: agentMarkets[0]?.createdAt,
      capabilities: [
        'fetch_trends',
        'classify_trend',
        'draft_market',
        'validate_market',
        'create_market',
        'resolve_market',
      ],
      version: '1.0.0',
    };

    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(status, null, 2) }] };
  }

  return { error: 'Resource not found', code: 'NOT_FOUND' };
}

/**
 * MCP Tool Handler - routes tool calls to appropriate functions
 */
async function handleToolCall(name: string, args: Record<string, any>): Promise<any> {
  logger.info('mcp-agent', `Tool called: ${name}`, { args });

  try {
    switch (name) {
      case 'fetch_trends': {
        const trends = await fetchTrends();
        const filtered = (args.source && args.source !== 'all')
          ? trends.filter((t: TrendItem) => t.source === args.source)
          : trends;
        const limited = filtered.slice(0, args.limit || 10);

        const response: TrendResponse = {
          trends: limited,
          source: args.source || 'all',
          timestamp: new Date().toISOString(),
        };

        return { success: true, result: response };
      }

      case 'classify_trend': {
        const trend = {
          topic: args.topic,
          query: args.query,
          source: args.source,
          url: args.url,
        };

        const classification = await classifyTrend(trend);

        return {
          success: true,
          result: {
            worthy: classification.worthy,
            momentumScore: classification.momentumScore,
            marketType: classification.suggestedMarketType,
            reasoning: classification.reason,
          },
        };
      }

      case 'draft_market': {
        const trend = {
          topic: args.topic,
          query: args.query,
          source: args.source,
          url: args.url,
        };

        const draft = await draftWithGemini(trend, 'General', {});

        return {
          success: true,
          result: {
            draft,
            confidence: 0.85,
            estimatedCloseDate: draft.closeDate,
          },
        };
      }

      case 'validate_market': {
        const market = {
          title: args.title,
          description: args.description,
          rules: args.rules,
          sourceOfTruth: args.sourceOfTruth,
        };

        const safety = await safetyCheckWithHaiku({
          title: market.title,
          description: market.description,
          rules: market.rules,
          sourceOfTruth: market.sourceOfTruth,
          closeDate: new Date().toISOString(),
          type: 'Prediction',
        });

        const validation: ValidationResponse = {
          passed: safety.pass,
          safetyScore: Math.round(safety.confidence * 100),
          confidence: safety.confidence,
          issues: safety.pass ? [] : [safety.reason],
          recommendations: safety.pass ? ['Market is safe to create'] : ['Fix the safety issues before creating'],
        };

        return { success: true, result: validation };
      }

      case 'create_market': {
        const input = {
          title: args.title,
          description: args.description,
          category: args.category,
          rules: args.rules,
          sourceOfTruth: args.sourceOfTruth,
          closeDate: args.closeDate,
          type: args.type,
          resolver: 'Presto Agent',
          resolutionMode: 'Agent assisted',
          agent: {
            createdByType: 'agent' as const,
            agentName: 'Presto MCP Agent',
            agentSource: 'mcp',
            agentConfidence: '85%',
          },
        };

        const result = await agentCreateMarket(input);

        const response: MarketCreationResponse = {
          success: result.ok,
          marketId: result.ok ? (result.txHash as string).slice(0, 42) : '',
          txHash: result.ok ? (result.txHash as string) : '',
          url: result.ok ? `https://presto-markets.vercel.app/markets/${(result.txHash as string).slice(0, 42)}` : '',
          timestamp: new Date().toISOString(),
        };

        return { success: true, result: response };
      }

      case 'resolve_market': {
        // This would call the resolution API
        // For now, return a placeholder response
        const response: ResolutionResponse = {
          success: false,
          marketId: args.marketId,
          outcome: args.outcome,
          confidence: 0.85,
          timestamp: new Date().toISOString(),
        };

        return {
          success: false,
          error: 'Resolution endpoint not yet implemented in MCP',
          result: response
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    logger.error('mcp-agent', `Tool error: ${name}`, { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * POST /api/mcp/agent
 * Handle MCP protocol requests
 * Requires: Authorization header with bearer token matching MCP_AGENT_TOKEN
 */
export async function POST(req: NextRequest) {
  // Authenticate using bearer token (constant-time comparison)
  const auth = req.headers.get('authorization') || '';
  const token = process.env.MCP_AGENT_TOKEN;

  if (!token) {
    logger.error('mcp-agent', 'MCP_AGENT_TOKEN not configured');
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  const expected = `Bearer ${token}`;
  const isValid = auth.length === expected.length &&
    Buffer.from(auth).equals(Buffer.from(expected));

  if (!isValid) {
    logger.warn('mcp-agent', 'Unauthorized MCP request', {
      hasAuth: auth.length > 0,
      method: req.method
    });
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const { method, params } = body;

    logger.info('mcp-agent', `MCP request: ${method}`, { params });

    // MCP protocol methods
    switch (method) {
      case 'resources/list':
        return NextResponse.json(await handleResourcesList());

      case 'resources/read':
        return NextResponse.json(await handleResourceRead(params.uri));

      case 'tools/list':
        return NextResponse.json({ tools: MCP_TOOLS });

      case 'tools/call':
        return NextResponse.json(await handleToolCall(params.name, params.arguments || {}));

      default:
        return NextResponse.json(
          { error: `Unknown method: ${method}` },
          { status: 400 }
        );
    }
  } catch (error) {
    logger.error('mcp-agent', 'Request error', { error: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mcp/agent
 * Return capability information and available tools
 */
export async function GET() {
  return NextResponse.json({
    name: 'Presto Agent MCP',
    version: '1.0.0',
    description: 'Model Context Protocol interface for Presto Markets autonomous agent',
    capabilities: {
      resources: true,
      tools: true,
    },
    resources: MCP_RESOURCES,
    tools: MCP_TOOLS.map(t => ({
      name: t.name,
      description: t.description,
    })),
  });
}
