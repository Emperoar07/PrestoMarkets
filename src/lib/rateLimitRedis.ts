import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { checkFixedWindowRateLimit } from './requestGuards';

// In-memory fallback stores (keyed by action/endpoint name)
const fallbackStores = new Map<string, Map<string, { count: number; resetAt: number }>>();

function getFallbackStore(endpoint: string): Map<string, { count: number; resetAt: number }> {
  if (!fallbackStores.has(endpoint)) {
    fallbackStores.set(endpoint, new Map());
  }
  return fallbackStores.get(endpoint)!;
}

let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  } catch (e) {
    console.warn('Failed to initialize Upstash Redis client:', e);
  }
}

/**
 * Checks rate limits for a given endpoint and client key.
 * If Upstash Redis credentials are present in the environment, it uses an Upstash sliding window.
 * Otherwise, it falls back to the in-memory Map fixed-window rate limiter.
 * Fails open (allows request) if Upstash throws an exception.
 */
export async function checkRateLimit(
  endpoint: string,
  key: string,
  options: { limit: number; windowSec: number }
): Promise<boolean> {
  if (redis) {
    try {
      const limitInstance = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(options.limit, `${options.windowSec} s`),
        analytics: true,
        prefix: `@upstash/ratelimit/presto/${endpoint}`,
      });
      const { success } = await limitInstance.limit(key);
      return success;
    } catch (error) {
      console.error(`[rate-limit] Upstash Redis error on ${endpoint}:`, error);
      // Fail open so an outage doesn't block write access
      return true;
    }
  }

  // Fallback to in-memory fixed window rate limiter
  const store = getFallbackStore(endpoint);
  return checkFixedWindowRateLimit(store, key, {
    max: options.limit,
    windowMs: options.windowSec * 1000,
  });
}
