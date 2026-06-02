import { describe, expect, it } from 'vitest';
import { checkFixedWindowRateLimit, isTrustedBrowserOrigin } from '../requestGuards';

describe('requestGuards', () => {
  it('rejects browser-origin checks when both Origin and Referer are absent', () => {
    const headers = new Headers({ host: 'presto-markets.vercel.app' });

    expect(isTrustedBrowserOrigin(headers)).toBe(false);
  });

  it('allows same-origin requests by host', () => {
    const headers = new Headers({
      host: 'presto-markets.vercel.app',
      origin: 'https://presto-markets.vercel.app',
    });

    expect(isTrustedBrowserOrigin(headers)).toBe(true);
  });

  it('allows explicitly configured application origins', () => {
    const headers = new Headers({
      host: 'preview.vercel.app',
      origin: 'https://presto-markets.vercel.app',
    });

    expect(isTrustedBrowserOrigin(headers, ['https://presto-markets.vercel.app'])).toBe(true);
  });

  it('enforces fixed-window rate limits by key', () => {
    const store = new Map<string, { count: number; resetAt: number }>();

    expect(checkFixedWindowRateLimit(store, 'client', { max: 2, windowMs: 60_000, now: 1 })).toBe(true);
    expect(checkFixedWindowRateLimit(store, 'client', { max: 2, windowMs: 60_000, now: 2 })).toBe(true);
    expect(checkFixedWindowRateLimit(store, 'client', { max: 2, windowMs: 60_000, now: 3 })).toBe(false);
    expect(checkFixedWindowRateLimit(store, 'client', { max: 2, windowMs: 60_000, now: 60_002 })).toBe(true);
  });
});
