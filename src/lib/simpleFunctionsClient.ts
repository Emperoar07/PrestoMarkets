/**
 * SimpleFunctions Client: Unified access to 48K+ Kalshi + Polymarket prediction markets
 *
 * Provides functions for:
 * - Searching across markets with filtering (volume, platform, limits)
 * - Detecting arbitrage opportunities between platforms
 * - Fetching real-time market details
 * - Scanning for markets matching a thesis
 *
 * All functions include:
 * - 8-second timeout per request (AbortController)
 * - Graceful error handling (returns empty arrays/null on failure)
 * - API key validation (SIMPLEFUNCTIONS_API_KEY env var)
 * - Full TypeScript type safety
 */

import { logger } from './logger';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Market data from SimpleFunctions API
 */
export type SimpleFunctionsMarket = {
  /** Unique market identifier */
  id: string;
  /** Market question/title */
  question: string;
  /** Platform: 'kalshi' or 'polymarket' */
  platform: 'kalshi' | 'polymarket';
  /** Current implied probability (0.0 to 1.0) */
  probability: number;
  /** 24-hour trading volume (optional) */
  volume24h?: number;
  /** Available liquidity (optional) */
  liquidity?: number;
  /** Market end date (ISO 8601 format) */
  endDate: string;
  /** Market category (optional) */
  category?: string;
};

/**
 * Detected arbitrage opportunity between two markets
 */
export type EdgeOpportunity = {
  /** First market in the opportunity */
  market1: SimpleFunctionsMarket;
  /** Second market in the opportunity */
  market2: SimpleFunctionsMarket;
  /** Absolute probability difference */
  priceDifference: number;
  /** Direction of arbitrage: buy market1 and sell market2, or vice versa */
  arbitrageOpportunity: 'buy_market1_sell_market2' | 'buy_market2_sell_market1';
  /** Expected profit percentage if arbitrage is executed */
  expectedProfit: number;
};

/**
 * Options for market search
 */
export type SearchOptions = {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Filter by platform ('kalshi' or 'polymarket') */
  platform?: 'kalshi' | 'polymarket';
  /** Minimum 24-hour trading volume filter */
  minVolume?: number;
};

// ── Constants ──────────────────────────────────────────────────────────────

const API_BASE_URL = 'https://api.simplefunctions.dev/v1';
const REQUEST_TIMEOUT_MS = 8000;

// ── Private Helpers ────────────────────────────────────────────────────────

/**
 * Validate that SIMPLEFUNCTIONS_API_KEY environment variable is set
 * @throws Error if API key is missing
 */
function validateApiKey(): string {
  const apiKey = process.env.SIMPLEFUNCTIONS_API_KEY;
  if (!apiKey) {
    const error = 'SIMPLEFUNCTIONS_API_KEY environment variable is required';
    throw new Error(error);
  }
  return apiKey;
}

/**
 * Create an AbortSignal with 8-second timeout
 */
function createTimeoutSignal(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return controller.signal;
}

/**
 * Transform API response fields from snake_case to camelCase
 */
function transformMarketResponse(data: Record<string, any>): SimpleFunctionsMarket {
  return {
    id: data.id,
    question: data.title,
    platform: data.platform as 'kalshi' | 'polymarket',
    probability: data.probability,
    volume24h: data.volume_24h,
    liquidity: data.liquidity,
    endDate: data.end_date,
    category: data.category,
  };
}

/**
 * Make authenticated request to SimpleFunctions API
 */
async function makeRequest(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response | null> {
  const url = `${API_BASE_URL}${path}`;

  try {
    const baseHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Merge with existing headers if provided
    let finalHeaders = baseHeaders;
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          baseHeaders[key] = value;
        });
      } else if (typeof options.headers === 'object') {
        Object.assign(baseHeaders, options.headers);
      }
    }
    finalHeaders = baseHeaders;

    const response = await fetch(url, {
      ...options,
      headers: finalHeaders,
      signal: createTimeoutSignal(),
    });

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('simpleFunctionsClient', `Request timeout to ${path} after ${REQUEST_TIMEOUT_MS}ms`);
      return null;
    }
    throw error;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Search for prediction markets across Kalshi + Polymarket
 *
 * @param query - Search query (keywords, asset names, market topics)
 * @param options - Optional search filters (limit, platform, minVolume)
 * @returns Array of matching markets, empty array on error
 *
 * @example
 * ```typescript
 * const btcMarkets = await searchMarkets('bitcoin price', {
 *   platform: 'kalshi',
 *   minVolume: 10000,
 *   limit: 20
 * });
 * ```
 */
export async function searchMarkets(
  query: string,
  options: SearchOptions = {},
): Promise<SimpleFunctionsMarket[]> {
  const apiKey = validateApiKey();

  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit ?? 10),
    });

    if (options.platform) {
      params.append('platform', options.platform);
    }

    if (options.minVolume !== undefined) {
      params.append('min_volume', String(options.minVolume));
    }

    const response = await makeRequest(`/markets/search?${params}`, apiKey);

    if (!response || !response.ok) {
      logger.warn(
        'simpleFunctionsClient',
        `Market search API returned ${response?.status ?? 'null'} for query: ${query}`,
      );
      return [];
    }

    const data = (await response.json()) as { results?: any[] };
    const results = data.results ?? [];

    return results
      .map((market) => {
        try {
          return transformMarketResponse(market);
        } catch (error) {
          logger.warn('simpleFunctionsClient', `Failed to transform market ${market.id}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
      .filter((m): m is SimpleFunctionsMarket => m !== null);
  } catch (error) {
    logger.error('simpleFunctionsClient', `Search markets failed for query: ${query}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Detect arbitrage opportunities between Kalshi and Polymarket
 *
 * Searches both platforms for the same or similar markets and identifies
 * mispricings where one platform has significantly better odds.
 *
 * @param topic - Topic to search for arbitrage opportunities
 * @returns Array of arbitrage opportunities, empty array on error
 *
 * @example
 * ```typescript
 * const opportunities = await detectEdgeOpportunities('Bitcoin ETF approval');
 * opportunities.forEach(opp => {
 *   console.log(`${opp.priceDifference * 100}% spread: ${opp.arbitrageOpportunity}`);
 * });
 * ```
 */
export async function detectEdgeOpportunities(topic: string): Promise<EdgeOpportunity[]> {
  const apiKey = validateApiKey();

  try {
    const [kalshiMarkets, polymarketMarkets] = await Promise.all([
      searchMarkets(topic, { platform: 'kalshi', limit: 10 }).catch(() => []),
      searchMarkets(topic, { platform: 'polymarket', limit: 10 }).catch(() => []),
    ]);

    const opportunities: EdgeOpportunity[] = [];

    // Match markets by similar question wording
    for (const kalshi of kalshiMarkets) {
      for (const poly of polymarketMarkets) {
        // Simple heuristic: if both markets are about the same topic and same end date
        const sameEndDate = kalshi.endDate === poly.endDate;
        const similarQuestion = areSimilarQuestions(kalshi.question, poly.question);

        if (sameEndDate && similarQuestion) {
          const priceDiff = Math.abs(kalshi.probability - poly.probability);

          // Only report opportunities with meaningful spreads (>10%)
          if (priceDiff > 0.1) {
            const arbitrage: EdgeOpportunity = {
              market1: kalshi,
              market2: poly,
              priceDifference: priceDiff,
              arbitrageOpportunity:
                kalshi.probability < poly.probability
                  ? 'buy_market1_sell_market2'
                  : 'buy_market2_sell_market1',
              expectedProfit: priceDiff * 100, // Simple model: spread is profit
            };

            opportunities.push(arbitrage);
          }
        }
      }
    }

    return opportunities;
  } catch (error) {
    logger.error('simpleFunctionsClient', `Edge detection failed for topic: ${topic}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Fetch real-time market data for a specific market
 *
 * @param marketId - Market identifier
 * @param platform - Platform ('kalshi' or 'polymarket')
 * @returns Market data or null if not found or error occurred
 *
 * @example
 * ```typescript
 * const market = await getMarketDetails('btc-etf-2026', 'kalshi');
 * if (market) {
 *   console.log(`Current probability: ${market.probability}`);
 * }
 * ```
 */
export async function getMarketDetails(
  marketId: string,
  platform: 'kalshi' | 'polymarket',
): Promise<SimpleFunctionsMarket | null> {
  const apiKey = validateApiKey();

  try {
    const response = await makeRequest(`/markets/${marketId}?platform=${platform}`, apiKey);

    if (!response) {
      return null;
    }

    if (!response.ok) {
      if (response.status === 404) {
        logger.warn('simpleFunctionsClient', `Market not found: ${marketId} on ${platform}`);
      } else {
        logger.warn(
          'simpleFunctionsClient',
          `Market details API returned ${response.status} for ${marketId}`,
        );
      }
      return null;
    }

    const data = (await response.json()) as Record<string, any>;
    return transformMarketResponse(data);
  } catch (error) {
    logger.error('simpleFunctionsClient', `Get market details failed for ${marketId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Find markets that match a specific investment thesis
 *
 * Searches for markets across both platforms that align with a given
 * thesis or strategic direction (e.g., "AI expansion", "interest rate hikes").
 *
 * @param thesis - Investment thesis or market theme to search for
 * @param maxResults - Maximum number of markets to return (default: 20)
 * @returns Array of matching markets, empty array on error
 *
 * @example
 * ```typescript
 * const aiMarkets = await scanForThesis('AI regulation and adoption', 50);
 * const bullishBTC = aiMarkets.filter(m => m.probability > 0.6);
 * ```
 */
export async function scanForThesis(
  thesis: string,
  maxResults: number = 20,
): Promise<SimpleFunctionsMarket[]> {
  const apiKey = validateApiKey();

  try {
    return await searchMarkets(thesis, {
      limit: maxResults,
    });
  } catch (error) {
    logger.error('simpleFunctionsClient', `Thesis scan failed for: ${thesis}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Check if two market questions are about the same topic
 * Uses simple word overlap heuristic
 */
function areSimilarQuestions(q1: string, q2: string): boolean {
  const words1 = new Set(q1.toLowerCase().split(/\W+/));
  const words2 = new Set(q2.toLowerCase().split(/\W+/));

  // Find intersection
  let overlap = 0;
  for (const word of words1) {
    if (words2.has(word) && word.length > 3) {
      overlap += 1;
    }
  }

  // At least 3 significant word overlaps suggests same topic
  return overlap >= 3;
}
