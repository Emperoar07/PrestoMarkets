import { describe, it, expect } from 'vitest';
import { validateMarketSafety } from '../marketSafetyValidator';

describe('validateMarketSafety', () => {
  it('blocks death/tragedy speculation about a real person', () => {
    const result = validateMarketSafety(
      'Will the president die before the election?',
      'Speculation on a sitting leader.',
      'Resolves YES on confirmed death.',
    );
    expect(result.ok).toBe(false);
  });

  it('does not block benign markets that merely contain a harmful word as a substring', () => {
    // "deadline" contains "dead", "studied" contains "die" — these used to false-positive.
    expect(validateMarketSafety(
      'Will the CEO ship the product before the deadline?',
      'A founder studied the roadmap and set a deadline.',
      'Resolves on the public release date.',
    ).ok).toBe(true);
  });

  it('allows harmful words when no real-person indicator is present', () => {
    expect(validateMarketSafety(
      'Will the death toll from the hurricane exceed 100?',
      'Tracking a natural disaster statistic.',
      'Resolves against the official report.',
    ).ok).toBe(true);
  });

  it('allows ordinary market topics', () => {
    expect(validateMarketSafety(
      'Will BTC close above $100k in December?',
      'A crypto price market.',
      'Resolves against CoinGecko close.',
    ).ok).toBe(true);
  });

  it('matches whole harmful words about a real person (murder + celebrity)', () => {
    expect(validateMarketSafety(
      'Will the actor be murdered this year?',
      'Speculation on a celebrity.',
      'Resolves YES on confirmation.',
    ).ok).toBe(false);
  });
});
