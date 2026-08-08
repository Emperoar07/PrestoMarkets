import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { sql } from 'drizzle-orm';
import { checkFixedWindowRateLimit } from './requestGuards';
import { getDb, hasDatabaseUrl } from './db/client';

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

  // Durable middle tier: a D1 (SQLite) fixed window (single atomic upsert per check). Cross-instance
  // like Upstash — an attacker spread across serverless instances no longer multiplies the limit —
  // at the cost of one DB roundtrip, acceptable for the mutation routes this guards.
  if (hasDatabaseUrl()) {
    try {
      const bucket = `${endpoint}:${key}`;
      const windowSec = Math.max(1, Math.floor(options.windowSec));
      const nowSec = Math.floor(Date.now() / 1000);
      const row = await getDb().get<{ count: number }>(sql`
        INSERT INTO rate_limits (bucket, window_start, count) VALUES (${bucket}, ${nowSec}, 1)
        ON CONFLICT(bucket) DO UPDATE SET
          count = CASE WHEN rate_limits.window_start < ${nowSec - windowSec} THEN 1 ELSE rate_limits.count + 1 END,
          window_start = CASE WHEN rate_limits.window_start < ${nowSec - windowSec} THEN ${nowSec} ELSE rate_limits.window_start END
        RETURNING count
      `);
      const count = Number(row?.count);
      // Opportunistic cleanup so stale buckets don't accumulate forever (~1% of checks).
      if (Math.random() < 0.01) {
        void getDb().run(sql`DELETE FROM rate_limits WHERE window_start < ${nowSec - 86_400}`).catch(() => undefined);
      }
      if (Number.isFinite(count)) return count <= options.limit;
    } catch (error) {
      console.error(`[rate-limit] D1 limiter error on ${endpoint}:`, error);
      // fall through to in-memory
    }
  }

  // Last resort: in-memory fixed window. On serverless this is PER-INSTANCE — warn once per
  // process so the gap is visible in logs without spamming every request.
  if (process.env.NODE_ENV === 'production' && !warnedInMemoryFallback) {
    warnedInMemoryFallback = true;
    console.warn('[rate-limit] Neither Upstash nor Postgres available — falling back to per-instance in-memory limits.');
  }
  const store = getFallbackStore(endpoint);
  return checkFixedWindowRateLimit(store, key, {
    max: options.limit,
    windowMs: options.windowSec * 1000,
  });
}
