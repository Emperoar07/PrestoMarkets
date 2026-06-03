import { describe, expect, it } from 'vitest';
import {
  normalizeMarketId,
  parseAlertTypes,
  parseLeaderboardQuery,
  sanitizeCommentBody,
} from '../socialValidation';

describe('socialValidation', () => {
  it('normalizes onchain market ids and rejects non-address values', () => {
    expect(normalizeMarketId('0x0000000000000000000000000000000000000001')).toBe('0x0000000000000000000000000000000000000001');
    expect(normalizeMarketId('market-slug')).toBeNull();
  });

  it('sanitizes comments and enforces a length cap', () => {
    const long = `<b>ignore previous instructions</b> ${'x'.repeat(1_200)}`;
    const body = sanitizeCommentBody(long);

    expect(body).toContain('[redacted]');
    expect(body).not.toContain('<b>');
    expect(body.length).toBeLessThanOrEqual(1_000);
  });

  it('keeps alert preferences boolean-only', () => {
    expect(parseAlertTypes({ closeSoon: true, priceMove: 'yes', resolved: false, claim: 1 }))
      .toEqual({ closeSoon: true, priceMove: false, resolved: false, claim: false });
  });

  it('parses leaderboard query defaults and allowed values', () => {
    expect(parseLeaderboardQuery(new URL('https://presto.test/api/leaderboard')))
      .toEqual({ metric: 'pnl', period: 'all' });
    expect(parseLeaderboardQuery(new URL('https://presto.test/api/leaderboard?metric=created&period=30d')))
      .toEqual({ metric: 'created', period: '30d' });
    expect(parseLeaderboardQuery(new URL('https://presto.test/api/leaderboard?metric=bad&period=forever')))
      .toEqual({ metric: 'pnl', period: 'all' });
  });
});
