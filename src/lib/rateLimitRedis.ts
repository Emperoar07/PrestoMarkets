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
let warnedInMemoryFallback = false;

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
 * Fails closed by default if Upstash throws. Read-only endpoints can opt into
 * fail-open behavior with `failOpen: true`.
 */
export async function checkRateLimit(
  endpoint: string,
  key: string,
  options: { limit: number; windowSec: number; failOpen?: boolean }
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
      return options.failOpen === true;
    }
  }

  // Fallback to in-memory fixed window rate limiter. On serverless this is PER-INSTANCE — an
  // attacker spread across instances multiplies the effective limit — so production should have
  // UPSTASH_REDIS_REST_URL/TOKEN configured. Warn once per process so the gap is visible in logs
  // without spamming every request.
  if (process.env.NODE_ENV === 'production' && !warnedInMemoryFallback) {
    warnedInMemoryFallback = true;
    console.warn('[rate-limit] Upstash Redis is NOT configured — falling back to per-instance in-memory limits. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for durable, cross-instance rate limiting.');
  }
  const store = getFallbackStore(endpoint);
  return checkFixedWindowRateLimit(store, key, {
    max: options.limit,
    windowMs: options.windowSec * 1000,
  });
}
