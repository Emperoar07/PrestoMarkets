// Neon-independent fallback tiers for the market-list snapshot. The app's grid is served from a
// cached snapshot so no user request waits on the 10-30s chain read. That cache lived ONLY in
// Neon Postgres — so when Neon goes down (e.g. its free-tier data-transfer quota is exceeded,
// HTTP 402) the snapshot read fails, /api/markets falls through to an inline chain read, and the
// app hangs on the loading state.
//
// These helpers add two tiers that do NOT touch Neon:
//   1. Filesystem (os.tmpdir()) — written on every successful snapshot save, read when Neon fails.
//      Per-instance and ephemeral, but survives across warm invocations, so a lambda that has
//      served once keeps serving instantly even with Neon down.
//   2. Committed seed (data/markets-worker-seed.json) — a compact last-known-good list shipped with the
//      build. The cold-start floor: a fresh instance with Neon down and no /tmp copy still returns
//      a non-empty grid instead of hanging, then self-refreshes from chain into /tmp.
//
// All tiers store the SLIM payload (image data-URIs replaced with a reference) so the files stay
// ~100KB, not ~860KB. Server-only (node fs); guarded so it is inert in the browser bundle.
//
// onchainMarkets (which imports this) is also pulled into the CLIENT bundle via appState, so a
// static `import 'node:fs'` here makes webpack try to bundle node builtins for the browser and the
// build fails (UnhandledSchemeError). Load fs/os/path through a webpack-invisible runtime require
// instead — these functions only ever execute on the server (guarded by `isServer`).
import type { AppMarket } from './appState';

export type FallbackSnapshot = { markets: AppMarket[]; at: number };

const isServer = typeof window === 'undefined';

type NodeFs = typeof import('node:fs');
type NodeOs = typeof import('node:os');
type NodePath = typeof import('node:path');

// webpack replaces __non_webpack_require__ with the runtime require and does NOT bundle the target
// modules — its purpose-built escape hatch for keeping node builtins out of a bundle that is also
// reachable from the client graph. No eval; the argument is a constant. Falls back to plain require
// outside webpack (e.g. vitest/node).
declare const __non_webpack_require__: NodeRequire | undefined;

function nodeModules(): { fs: NodeFs; os: NodeOs; path: NodePath } | null {
  if (!isServer) return null;
  try {
    const req: NodeRequire = typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require;
    return { fs: req('node:fs'), os: req('node:os'), path: req('node:path') };
  } catch {
    return null;
  }
}

function tmpSnapshotPath(mods: { os: NodeOs; path: NodePath }): string {
  return mods.path.join(mods.os.tmpdir(), 'presto-market-snapshot.json');
}

/**
 * Replace heavy inline base64 image data-URIs with a reference to the cacheable image endpoint,
 * so the persisted snapshot (and every read of it) is ~8x smaller. Tiny branded SVGs and plain
 * http/ref URLs are left as-is. A content hash busts the edge cache when an image is regenerated.
 */
export function slimSnapshotForStorage(markets: AppMarket[]): AppMarket[] {
  return markets.map((m) => {
    const u = m.imageURI || '';
    if (u.startsWith('data:image/') && !u.startsWith('data:image/svg') && u.length > 4096) {
      let h = 5381;
      for (let i = 0; i < u.length; i += 199) h = ((h * 33) ^ u.charCodeAt(i)) >>> 0;
      const v = (h ^ u.length).toString(36);
      return { ...m, imageURI: `/api/market-images/${m.id.toLowerCase()}?v=${v}` };
    }
    return m;
  });
}

/** Best-effort write of the slim snapshot to the filesystem tier. Never throws. */
export function writeFilesystemSnapshot(markets: AppMarket[]): void {
  const mods = nodeModules();
  if (!mods || markets.length === 0) return;
  try {
    const slim = slimSnapshotForStorage(markets);
    mods.fs.writeFileSync(tmpSnapshotPath(mods), JSON.stringify({ markets: slim, at: Date.now() }));
  } catch {
    /* filesystem unavailable/read-only — ignore, other tiers still serve */
  }
}

/** Read the filesystem tier. Returns null when absent or unreadable. */
export function readFilesystemSnapshot(): FallbackSnapshot | null {
  const mods = nodeModules();
  if (!mods) return null;
  try {
    const raw = mods.fs.readFileSync(tmpSnapshotPath(mods), 'utf8');
    const parsed = JSON.parse(raw) as FallbackSnapshot;
    if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) return null;
    return { markets: parsed.markets, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

// ── Upstash Redis tier (optional, cross-instance) ──────────────────────────
// The filesystem tier is per-instance, so a cold lambda with Neon down only has the committed
// seed until it refreshes from chain. Upstash Redis (REST, fetch-based — no node builtins, its own
// free-tier quota independent of Neon) gives a SHARED tier every instance can read, so fresh data
// propagates cross-instance even while Neon is down. Entirely optional: inert unless
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Stores the slim payload (~77KB, far
// under Upstash's value limit). Best-effort; never throws.
const UPSTASH_KEY = 'presto:market-snapshot:latest';

function upstashConfigured(): boolean {
  return isServer
    && !!process.env.UPSTASH_REDIS_REST_URL
    && !!process.env.UPSTASH_REDIS_REST_TOKEN;
}

export async function writeUpstashSnapshot(markets: AppMarket[]): Promise<void> {
  if (!upstashConfigured() || markets.length === 0) return;
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    const payload: FallbackSnapshot = { markets: slimSnapshotForStorage(markets), at: Date.now() };
    await redis.set(UPSTASH_KEY, JSON.stringify(payload));
  } catch {
    /* Upstash unavailable — other tiers still serve */
  }
}

export async function readUpstashSnapshot(): Promise<FallbackSnapshot | null> {
  if (!upstashConfigured()) return null;
  try {
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    const raw = await redis.get<string | FallbackSnapshot>(UPSTASH_KEY);
    if (!raw) return null;
    // @upstash/redis may return the parsed object or the raw string depending on how it was stored.
    const parsed: FallbackSnapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) return null;
    return { markets: parsed.markets, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

/**
 * Read the committed seed tier from the application bundle. A runtime fs lookup works on Node
 * serverless hosts but not in Cloudflare Workers, where the project directory is not a normal
 * filesystem. The compact seed avoids embedding the full historical archive in every Worker while
 * giving OpenNext a concrete asset to trace into the server bundle.
 */
export async function readBundledSeedSnapshot(): Promise<FallbackSnapshot | null> {
  if (!isServer) return null;
  try {
    const module = await import('../../data/markets-worker-seed.json');
    const parsed = module.default as { markets?: AppMarket[]; at?: number };
    if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) return null;
    return { markets: parsed.markets, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}
