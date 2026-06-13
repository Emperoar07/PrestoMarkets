import { afterEach, describe, expect, it, vi } from 'vitest';

describe('checkRateLimit', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('fails closed by default when Redis throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    vi.doMock('@upstash/redis', () => ({ Redis: vi.fn() }));
    const Ratelimit = vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      })) as ReturnType<typeof vi.fn> & { slidingWindow: ReturnType<typeof vi.fn> };
    Ratelimit.slidingWindow = vi.fn();
    vi.doMock('@upstash/ratelimit', () => ({ Ratelimit }));

    const { checkRateLimit } = await import('../rateLimitRedis');

    await expect(checkRateLimit('comments-write', 'client', { limit: 1, windowSec: 60 })).resolves.toBe(false);
  });

  it('can fail open for read-only endpoints', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    vi.doMock('@upstash/redis', () => ({ Redis: vi.fn() }));
    const Ratelimit = vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockRejectedValue(new Error('redis unavailable')),
      })) as ReturnType<typeof vi.fn> & { slidingWindow: ReturnType<typeof vi.fn> };
    Ratelimit.slidingWindow = vi.fn();
    vi.doMock('@upstash/ratelimit', () => ({ Ratelimit }));

    const { checkRateLimit } = await import('../rateLimitRedis');

    await expect(checkRateLimit('activity', 'client', { limit: 1, windowSec: 60, failOpen: true })).resolves.toBe(true);
  });
});
