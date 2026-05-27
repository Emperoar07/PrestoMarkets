/**
 * Model Context Protocol (MCP) interface for Presto agent
 * Exposes agent capabilities as MCP resources and tools for integration with Claude and other MCPs
 */

import type { TrendItem, MarketDraft } from './agentPipeline';
import type { SafetyResult } from './agentPipeline';

/**
 * MCP Resource: Agent Status
 * Returns current agent state and capabilities
 */
export const agentStatusResource = {
  uri: 'presto://agent/status',
  name: 'Agent Status',
  description: 'Current Presto agent status and capabilities',
  mimeType: 'application/json',
};

/**
 * MCP Tool: Fetch Trends
 * Retrieves current market trends from multiple sources
 */
export const fetchTrendsTool = {
  name: 'fetch_trends',
  description: 'Fetch current market trends from news, social, sports, and crypto sources',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source: {
        type: 'string',
        description: 'Filter by trend source: serper, grok-x, sports, rss, or all (default: all)',
        enum: ['serper', 'grok-x', 'sports', 'rss', 'all'],
      },
      limit: {
        type: 'number',
        description: 'Maximum number of trends to return (default: 10)',
        default: 10,
      },
    },
    required: [],
  },
};

/**
 * MCP Tool: Classify Trend
 * Analyzes a trend for market-worthiness
 */
export const classifyTrendTool = {
  name: 'classify_trend',
  description: 'Analyze a trend for market creation potential and momentum',
  inputSchema: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: 'The trend topic/headline to classify',
      },
      query: {
        type: 'string',
        description: 'Additional context or details about the trend',
      },
      source: {
        type: 'string',
        description: 'Where the trend came from (serper, grok-x, sports, rss, etc.)',
      },
    },
    required: ['topic', 'query', 'source'],
  },
};

/**
 * MCP Tool: Draft Market
 * Generates market structure from a classified trend
 */
export const draftMarketTool = {
  name: 'draft_market',
  description: 'Generate market title, rules, and structure from a trend',
  inputSchema: {
    type: 'object' as const,
    properties: {
      topic: {
        type: 'string',
        description: 'The news headline or trend topic',
      },
      query: {
        type: 'string',
        description: 'Trend context and details',
      },
      source: {
        type: 'string',
        description: 'Trend source URL',
      },
      url: {
        type: 'string',
        description: 'Source URL for market resolution',
      },
    },
    required: ['topic', 'query'],
  },
};

/**
 * MCP Tool: Validate Market Safety
 * Runs safety checks on a market draft before creation
 */
export const validateMarketTool = {
  name: 'validate_market',
  description: 'Run safety and quality checks on a market draft',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Market title/question',
      },
      description: {
        type: 'string',
        description: 'Market description',
      },
      rules: {
        type: 'string',
        description: 'Resolution rules',
      },
      sourceOfTruth: {
        type: 'string',
        description: 'URL for resolving market outcome',
      },
    },
    required: ['title', 'description', 'rules', 'sourceOfTruth'],
  },
};

/**
 * MCP Tool: Create Market
 * Deploys a validated market draft to Arc blockchain
 */
export const createMarketTool = {
  name: 'create_market',
  description: 'Deploy a validated market to Arc blockchain',
  inputSchema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Market title/question',
      },
      description: {
        type: 'string',
        description: 'Market description',
      },
      rules: {
        type: 'string',
        description: 'Resolution rules',
      },
      sourceOfTruth: {
        type: 'string',
        description: 'URL for resolving market',
      },
      category: {
        type: 'string',
        description: 'Market category (Crypto, Politics, Sports, etc.)',
      },
      closeDate: {
        type: 'string',
        description: 'Market close date (ISO 8601)',
      },
      type: {
        type: 'string',
        description: 'Market type (Prediction or Opinion)',
        enum: ['Prediction', 'Opinion'],
      },
    },
    required: ['title', 'description', 'rules', 'sourceOfTruth', 'category', 'closeDate', 'type'],
  },
};

/**
 * MCP Tool: Resolve Market
 * Executes agent resolution for a market
 */
export const resolveMarketTool = {
  name: 'resolve_market',
  description: 'Execute agent-assisted resolution for a market',
  inputSchema: {
    type: 'object' as const,
    properties: {
      marketId: {
        type: 'string',
        description: 'Market contract address to resolve',
      },
      outcome: {
        type: 'string',
        description: 'Proposed outcome (YES or NO for binary, option label for polls)',
      },
      confidence: {
        type: 'string',
        description: 'Agent confidence level (Low, Medium, High)',
        enum: ['Low', 'Medium', 'High'],
      },
      reasoning: {
        type: 'string',
        description: 'Why the agent is proposing this outcome',
      },
    },
    required: ['marketId', 'outcome', 'confidence', 'reasoning'],
  },
};

/**
 * MCP Resource Response Types
 */
export interface AgentStatus {
  status: 'ready' | 'busy' | 'error';
  activeMarkets: number;
  totalCreated: number;
  lastMarketTime?: string;
  capabilities: string[];
  version: string;
}

export interface TrendResponse {
  trends: TrendItem[];
  source: string;
  timestamp: string;
}

export interface ClassificationResponse {
  worthy: boolean;
  momentumScore: number;
  marketType: 'Prediction' | 'Opinion';
  reasoning: string;
}

export interface DraftResponse {
  draft: MarketDraft;
  confidence: number;
  estimatedCloseDate: string;
}

export interface ValidationResponse {
  passed: boolean;
  safetyScore: number;
  confidence: number;
  issues: string[];
  recommendations: string[];
}

export interface MarketCreationResponse {
  success: boolean;
  marketId: string;
  txHash: string;
  url: string;
  timestamp: string;
}

export interface ResolutionResponse {
  success: boolean;
  marketId: string;
  outcome: string;
  confidence: number;
  txHash?: string;
  timestamp: string;
}

/**
 * All MCP tools available from agent
 */
export const MCP_TOOLS = [
  fetchTrendsTool,
  classifyTrendTool,
  draftMarketTool,
  validateMarketTool,
  createMarketTool,
  resolveMarketTool,
];

/**
 * All MCP resources available from agent
 */
export const MCP_RESOURCES = [
  agentStatusResource,
];
