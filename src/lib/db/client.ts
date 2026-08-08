import { drizzle, type DrizzleD1Database, type AnyD1Database } from 'drizzle-orm/d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import * as schema from './schema';

type PrestoDb = DrizzleD1Database<typeof schema>;
// drizzle's own binding type — resolves to the D1Database global when Workers runtime types are
// present and degrades gracefully otherwise. Using it (instead of the ambient `D1Database` global)
// keeps this module self-contained: the build does NOT need the full `wrangler types` runtime lib,
// whose global Response/fetch redefinitions would otherwise break ~100 unrelated call sites.
type D1Binding = AnyD1Database;

// The D1 binding name declared in each shard's wrangler config (scripts/prepare-cloudflare-workers.mjs).
const D1_BINDING = 'DB';

// Cache the drizzle instance per underlying D1 binding object. getCloudflareContext() returns the
// same env for an isolate's lifetime, so this is effectively a singleton — but keying on the binding
// keeps it correct across the (rare) local-dev proxy swaps and never leaks a stale handle.
let cachedBinding: D1Binding | null = null;
let cachedDb: PrestoDb | null = null;

/**
 * Resolve the D1 binding from the Cloudflare request context. Returns null anywhere the context or
 * binding is absent (build-time static analysis, local `next dev` without a bound D1, older shards
 * not yet redeployed with the binding) so callers degrade to their no-DB fallbacks instead of
 * throwing. Also honors a global set by the local-dev bootstrap, if present.
 */
function resolveBinding(): D1Binding | null {
  try {
    const { env } = getCloudflareContext();
    const binding = (env as Record<string, unknown>)[D1_BINDING];
    if (binding) return binding as D1Binding;
  } catch {
    // getCloudflareContext throws outside a request context (e.g. during build) — treat as no DB.
  }
  const fromGlobal = (globalThis as Record<string, unknown>)[`__D1_${D1_BINDING}`];
  return fromGlobal ? (fromGlobal as D1Binding) : null;
}

/** True when a D1 binding is reachable — the SQLite analogue of the old DATABASE_URL check. */
export function hasDatabaseUrl(): boolean {
  return resolveBinding() !== null;
}

/**
 * The drizzle D1 handle. Throws only when called with no binding reachable — every data-layer
 * caller guards with hasDatabaseUrl() first, so this throw is a real misconfiguration, not the
 * normal no-DB path.
 */
export function getDb(): PrestoDb {
  const binding = resolveBinding();
  if (!binding) {
    throw new Error('D1 binding "DB" is not available in this Worker context.');
  }
  if (cachedDb && cachedBinding === binding) return cachedDb;
  cachedBinding = binding;
  cachedDb = drizzle(binding, { schema });
  return cachedDb;
}
