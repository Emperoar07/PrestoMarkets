/**
 * Pure aggregation for the portfolio cockpit. Works off the already-loaded on-chain
 * positions + markets — no DB, no extra RPC. "Unrealized" P&L here is value − cost basis
 * using the current parimutuel pool-implied value (there is no order-book mark price).
 */

export type PositionLike = {
  marketId: string;
  value: string; // "$X"
  costBasis: string; // "$X"
  status: string; // 'Open' | 'Claimable' | 'Realized' | ...
};

export type MarketLike = {
  id: string;
  category?: string;
  status: string;
};

export type PortfolioInsights = {
  totalValue: number;
  totalCost: number;
  unrealizedPnl: number;
  claimableValue: number;
  claimableCount: number;
  closingSoonCount: number;
  exposure: Array<{ category: string; value: number; pct: number }>;
};

export function parseUsdAmount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computePortfolioInsights(positions: PositionLike[], markets: MarketLike[]): PortfolioInsights {
  const marketById = new Map(markets.map((m) => [m.id.toLowerCase(), m]));
  let totalValue = 0;
  let totalCost = 0;
  let claimableValue = 0;
  let claimableCount = 0;
  let closingSoonCount = 0;
  const exposureMap = new Map<string, number>();

  for (const position of positions) {
    const value = parseUsdAmount(position.value);
    totalValue += value;
    totalCost += parseUsdAmount(position.costBasis);

    if (position.status === 'Claimable') {
      claimableValue += value;
      claimableCount += 1;
    }

    const market = marketById.get(position.marketId.toLowerCase());
    const category = market?.category?.trim() || 'Other';
    exposureMap.set(category, (exposureMap.get(category) ?? 0) + value);
    if (market?.status === 'Closing soon') closingSoonCount += 1;
  }

  const exposure = Array.from(exposureMap.entries())
    .map(([category, value]) => ({ category, value, pct: totalValue > 0 ? value / totalValue : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    totalValue,
    totalCost,
    unrealizedPnl: totalValue - totalCost,
    claimableValue,
    claimableCount,
    closingSoonCount,
    exposure,
  };
}
