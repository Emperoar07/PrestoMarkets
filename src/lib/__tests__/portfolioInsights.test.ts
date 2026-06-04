import { describe, expect, it } from 'vitest';
import { computePortfolioInsights, parseUsdAmount } from '../portfolioInsights';

describe('parseUsdAmount', () => {
  it('parses $-prefixed and comma values', () => {
    expect(parseUsdAmount('$1,250.50')).toBeCloseTo(1250.5);
    expect(parseUsdAmount('42')).toBe(42);
    expect(parseUsdAmount(undefined)).toBe(0);
    expect(parseUsdAmount('n/a')).toBe(0);
  });
});

describe('computePortfolioInsights', () => {
  const markets = [
    { id: '0xAAA', category: 'Crypto', status: 'Open' },
    { id: '0xBBB', category: 'Sports', status: 'Closing soon' },
    { id: '0xCCC', category: 'Crypto', status: 'Resolved' },
  ];

  it('totals value/cost, derives unrealized P&L, claimable and closing-soon', () => {
    const positions = [
      { marketId: '0xaaa', value: '$100', costBasis: '$80', status: 'Open' },
      { marketId: '0xbbb', value: '$50', costBasis: '$60', status: 'Open' },
      { marketId: '0xccc', value: '$30', costBasis: '$10', status: 'Claimable' },
    ];
    const insights = computePortfolioInsights(positions, markets);
    expect(insights.totalValue).toBeCloseTo(180);
    expect(insights.totalCost).toBeCloseTo(150);
    expect(insights.unrealizedPnl).toBeCloseTo(30);
    expect(insights.claimableValue).toBeCloseTo(30);
    expect(insights.claimableCount).toBe(1);
    expect(insights.closingSoonCount).toBe(1); // the 0xbbb market is closing soon
  });

  it('aggregates exposure by category, ranked, with shares summing to ~1', () => {
    const positions = [
      { marketId: '0xaaa', value: '$100', costBasis: '$80', status: 'Open' },
      { marketId: '0xccc', value: '$60', costBasis: '$40', status: 'Open' },
      { marketId: '0xbbb', value: '$40', costBasis: '$40', status: 'Open' },
    ];
    const insights = computePortfolioInsights(positions, markets);
    expect(insights.exposure[0]).toMatchObject({ category: 'Crypto', value: 160 });
    expect(insights.exposure[1]).toMatchObject({ category: 'Sports', value: 40 });
    expect(insights.exposure.reduce((s, e) => s + e.pct, 0)).toBeCloseTo(1);
  });

  it('buckets positions with no matching market under Other', () => {
    const insights = computePortfolioInsights(
      [{ marketId: '0xZZZ', value: '$25', costBasis: '$25', status: 'Open' }],
      markets,
    );
    expect(insights.exposure[0]).toMatchObject({ category: 'Other', value: 25 });
  });
});
