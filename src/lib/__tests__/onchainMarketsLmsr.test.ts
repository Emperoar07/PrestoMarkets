import { describe, expect, it } from 'vitest';
import { getLmsrOdds } from '../onchainMarkets';

const WAD = 10n ** 18n;

describe('getLmsrOdds', () => {
  it('maps WAD prices to whole-percent odds that sum to 100', () => {
    // A 50/50 binary market: each price is 0.5 WAD.
    expect(getLmsrOdds([WAD / 2n, WAD / 2n])).toEqual([50, 50]);
  });

  it('reflects a skewed book and still sums to 100', () => {
    // 0.7 / 0.3 split.
    const odds = getLmsrOdds([(WAD * 7n) / 10n, (WAD * 3n) / 10n]);
    expect(odds.reduce((a, b) => a + b, 0)).toBe(100);
    expect(odds[0]).toBeGreaterThan(odds[1]);
  });

  it('normalizes a three-way market whose raw prices round below 100', () => {
    // Three ~1/3 prices: 0.3333.. WAD each. Renormalization must still total 100.
    const third = WAD / 3n;
    const odds = getLmsrOdds([third, third, third]);
    expect(odds.reduce((a, b) => a + b, 0)).toBe(100);
    for (const o of odds) expect(o).toBeGreaterThanOrEqual(33);
  });
});
