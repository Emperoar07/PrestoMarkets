import type { Market, MarketStatus } from './markets';

export type PublicMarketListQuery = {
  category: string | null;
  status: string | null;
  limit: number;
  offset: number;
};

export type PublicMarket = {
  id: string;
  title: string;
  description: string;
  category: string;
  categories: string[];
  type: Market['type'];
  status: MarketStatus;
  volume: string;
  closeLabel: string;
  imageURI?: string;
  collateral: 'USDC';
  outcomes: Array<{
    label: string;
    odds: number;
    probability: number;
  }>;
  sourceOfTruth: string;
  rules: string;
  createdByType: Market['createdByType'];
  agent: null | {
    name?: string;
    confidence?: string;
    reason?: string;
    trendSource?: string;
    trendUrl?: string;
    momentumScore?: number;
    safetyScore?: number;
  };
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function encodeCursor(offset: number): string {
  return Buffer.from(`${offset}:`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const value = Number(decoded.split(':')[0]);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function parseMarketListQuery(url: URL): PublicMarketListQuery {
  const limitParam = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitParam) ? Math.floor(limitParam) : DEFAULT_LIMIT));
  return {
    category: url.searchParams.get('category')?.trim().toLowerCase() || null,
    status: url.searchParams.get('status')?.trim().toLowerCase() || null,
    limit,
    offset: decodeCursor(url.searchParams.get('cursor')),
  };
}

export function serializePublicMarket(market: Market): PublicMarket {
  return {
    id: market.id,
    title: market.title,
    description: market.description,
    category: market.category,
    categories: market.categories?.length ? market.categories : [market.category],
    type: market.type,
    status: market.status,
    volume: market.volume,
    closeLabel: market.closeLabel,
    imageURI: market.imageURI,
    collateral: market.collateral,
    outcomes: market.outcomes.map((outcome) => ({
      label: outcome.label,
      odds: outcome.odds,
      probability: Number((outcome.odds / 100).toFixed(4)),
    })),
    sourceOfTruth: market.sourceOfTruth,
    rules: market.rules,
    createdByType: market.createdByType ?? 'user',
    agent: market.createdByType === 'agent'
      ? {
          name: market.agentName,
          confidence: market.agentConfidence,
          reason: market.agentReason,
          trendSource: market.trendSource,
          trendUrl: market.trendUrl,
          momentumScore: market.momentumScore,
          safetyScore: market.safetyScore,
        }
      : null,
  };
}

export function filterAndPageMarkets(markets: Market[], query: PublicMarketListQuery): {
  items: Market[];
  nextCursor: string | null;
} {
  const filtered = markets.filter((market) => {
    const categoryMatch = query.category
      ? [market.category, ...(market.categories ?? [])].some((category) => category.toLowerCase() === query.category)
      : true;
    const statusMatch = query.status ? market.status.toLowerCase() === query.status : true;
    return categoryMatch && statusMatch;
  });

  const items = filtered.slice(query.offset, query.offset + query.limit);
  const nextOffset = query.offset + items.length;
  return {
    items,
    nextCursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
  };
}

export function getPublicApiHeaders(cacheSeconds = 30): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`,
  };
}

export function publicOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: getPublicApiHeaders(),
  });
}
