import { describe, expect, it } from 'vitest';
import { shouldTriggerLimitOrder, limitBoundFromQuote, validateCreateLimitOrder } from '../limitOrders';

describe('shouldTriggerLimitOrder', () => {
  it('buys when the price falls to or below the limit', () => {
    expect(shouldTriggerLimitOrder('buy', 4400, 4500)).toBe(true);  // 44c <= 45c
    expect(shouldTriggerLimitOrder('buy', 4500, 4500)).toBe(true);  // exactly at limit
    expect(shouldTriggerLimitOrder('buy', 4600, 4500)).toBe(false); // 46c > 45c
  });

  it('sells when the price rises to or above the limit', () => {
    expect(shouldTriggerLimitOrder('sell', 6100, 6000)).toBe(true);  // 61c >= 60c
    expect(shouldTriggerLimitOrder('sell', 6000, 6000)).toBe(true);
    expect(shouldTriggerLimitOrder('sell', 5900, 6000)).toBe(false);
  });

  it('never fires on a non-finite price', () => {
    expect(shouldTriggerLimitOrder('buy', Number.NaN, 4500)).toBe(false);
  });
});

describe('limitBoundFromQuote', () => {
  it('buy bound is the quote marked up by slippage (max you pay)', () => {
    expect(limitBoundFromQuote('buy', 100, 200)).toBeCloseTo(102); // +2%
  });
  it('sell bound is the quote marked down by slippage (min you receive)', () => {
    expect(limitBoundFromQuote('sell', 100, 200)).toBeCloseTo(98); // -2%
  });
});

describe('validateCreateLimitOrder', () => {
  const valid = {
    id: 'order-1234',
    marketId: '0x1234567890123456789012345678901234567890',
    outcomeIndex: 0,
    side: 'buy' as const,
    limitPriceBps: 4500,
    shares: 10,
  };
  it('accepts a valid order', () => {
    expect(validateCreateLimitOrder(valid)).toBeNull();
  });
  it('rejects out-of-range price', () => {
    expect(validateCreateLimitOrder({ ...valid, limitPriceBps: 10_000 })).toMatch(/price/i);
    expect(validateCreateLimitOrder({ ...valid, limitPriceBps: 0 })).toMatch(/price/i);
  });
  it('rejects a bad market address and non-positive shares', () => {
    expect(validateCreateLimitOrder({ ...valid, marketId: '0xnope' })).toMatch(/market/i);
    expect(validateCreateLimitOrder({ ...valid, shares: 0 })).toMatch(/shares/i);
  });
});
