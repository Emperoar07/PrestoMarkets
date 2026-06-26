import { describe, expect, it } from 'vitest';
import {
  buildFixedShareQuote,
  estimateParimutuelPayout,
  addSlippageBps6,
  lmsrBuyTotalCost6,
  lmsrFee6,
  normalizeOutcomeOdds,
} from '../marketUtils';

describe('normalizeOutcomeOdds', () => {
  it('normalizes binary odds so chart, cards, and trade panels share one source of truth', () => {
    expect(normalizeOutcomeOdds([4, 95])).toEqual([4, 96]);
    expect(normalizeOutcomeOdds([62, 38])).toEqual([62, 38]);
  });

  it('falls back to equal odds when inputs are missing or invalid', () => {
    expect(normalizeOutcomeOdds([0, 0])).toEqual([50, 50]);
    expect(normalizeOutcomeOdds([NaN, -1, Infinity])).toEqual([33, 33, 34]);
  });
});

describe('buildFixedShareQuote', () => {
  it('keeps Presto V1 honest: shares are minted 1:1 and payout is parimutuel estimate', () => {
    expect(buildFixedShareQuote({ amountUsdc: 10, oddsPercent: 50 })).toEqual({
      stakeUsdc: 10,
      shares: 10,
      impliedProbability: 0.5,
      estimatedPayoutUsdc: 20,
      estimatedProfitUsdc: 10,
    });
  });

  it('uses normalized odds so a 4/95 market does not silently lose one percentage point', () => {
    const quote = buildFixedShareQuote({ amountUsdc: 10, oddsPercent: 4 });

    expect(quote.shares).toBe(10);
    expect(quote.impliedProbability).toBeCloseTo(0.04, 5);
    expect(quote.estimatedPayoutUsdc).toBeCloseTo(250, 5);
    expect(quote.estimatedProfitUsdc).toBeCloseTo(240, 5);
  });

  it('returns a zero quote for invalid amounts', () => {
    expect(buildFixedShareQuote({ amountUsdc: -10, oddsPercent: 50 })).toEqual({
      stakeUsdc: 0,
      shares: 0,
      impliedProbability: 0.5,
      estimatedPayoutUsdc: 0,
      estimatedProfitUsdc: 0,
    });
  });
});

describe('estimateParimutuelPayout', () => {
  it('remains backward compatible with existing callers', () => {
    expect(estimateParimutuelPayout(10, 80)).toBeCloseTo(12.5, 5);
  });
});

describe('LMSR fee-aware pricing helpers', () => {
  it('adds the market fee to buyCost before slippage', () => {
    const cost6 = BigInt(6_610_000);

    expect(lmsrFee6(cost6, 500)).toBe(BigInt(330_500));
    expect(lmsrBuyTotalCost6(cost6, 500)).toBe(BigInt(6_940_500));
    expect(addSlippageBps6(lmsrBuyTotalCost6(cost6, 500), 200)).toBe(BigInt(7_079_310));
  });
});
