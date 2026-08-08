// Off-Worker D1 populator. The full on-chain read (factory scan + trade-log decode across every
// market) exceeds the Workers FREE-plan CPU ceiling, so market_list_cache can never self-populate
// on-Worker. This runs that exact read in plain Node (no CPU wall) by driving the app's OWN
// fetchOnchainMarkets through a D1-over-REST shim, then writes the authoritative `latest` row and
// one truthful odds snapshot per market. It reuses the app's decoder end-to-end — no reimplementation.
//
//   node scripts/harvest-d1-snapshot.mjs
//
// Secrets are read from .env.local and never printed. The D1 database id and CF account id are
// identifiers, not secrets.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const DB_ID = '20b734c5-71f3-46b0-97ec-578fd203c112';
const TMP_DIR = path.join(root, '.harvest-tmp');

// ── env: load .env.local into process.env (getArcConfig reads NEXT_PUBLIC_* at call time) ────
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (process.env[k] === undefined) process.env[k] = v;
}
const account = process.env.CF_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
if (!account || !token) { console.error('Missing CF_ACCOUNT_ID or a CF API token in .env.local'); process.exit(1); }

// ── D1-over-REST shim implementing the drizzle-orm/d1 binding contract ───────────────────────
// prepare(sql).bind(...params) -> { run(), all()->{results}, raw()->rows[][] }, plus client.batch().
// getDb() resolves this via resolveBinding()'s globalThis.__D1_DB fallback (getCloudflareContext
// throws off-Worker and is caught, so the global is used).
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DB_ID}/query`;
async function d1exec(sql, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: params ?? [] }),
  });
  let json;
  try { json = await res.json(); } catch { throw new Error(`D1 REST non-JSON response (HTTP ${res.status})`); }
  if (!json.success) throw new Error('D1 query failed: ' + ((json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`));
  return json.result?.[0] ?? { results: [], meta: {} };
}
function bound(sql, params) {
  return {
    sql, params,
    async run() { const r = await d1exec(sql, params); return { success: true, meta: r.meta ?? {}, results: r.results ?? [] }; },
    async all() { const r = await d1exec(sql, params); return { results: r.results ?? [] }; },
    async raw() { const r = await d1exec(sql, params); return (r.results ?? []).map((row) => Object.keys(row).map((k) => row[k])); },
  };
}
globalThis.__D1_DB = {
  prepare(sql) {
    return {
      bind(...params) { return bound(sql, params); },
      run() { return bound(sql, []).run(); },
      all() { return bound(sql, []).all(); },
      raw() { return bound(sql, []).raw(); },
    };
  },
  async batch(stmts) { const out = []; for (const s of stmts) out.push(await d1exec(s.sql, s.params)); return out; },
};
// ── bundle the app's real market reader (resolves the @/ alias + strips TS) ──────────────────
const aliasPlugin = {
  name: 'presto-alias',
  setup(build) {
    // Stub @opennextjs/cloudflare so its getCloudflareContext throws (caught) -> global shim used.
    build.onResolve({ filter: /^@opennextjs\/cloudflare$/ }, () => ({ path: 'cf-stub', namespace: 'cf-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({
      contents: 'export function getCloudflareContext(){throw new Error("no cf ctx off-worker");}', loader: 'js',
    }));
    build.onResolve({ filter: /^@\// }, (args) =>
      build.resolve('./' + args.path.slice(2), { resolveDir: path.join(root, 'src'), kind: args.kind }));
  },
};
const outfile = path.join(TMP_DIR, 'app.cjs');
await esbuild.build({
  stdin: {
    contents: [
      "export { fetchOnchainMarkets } from '@/lib/onchainMarkets';",
      "export { recordMarketSnapshots } from '@/lib/marketSnapshots';",
      "export { getDb } from '@/lib/db/client';",
      "export { marketListCache } from '@/lib/db/schema';",
      "export { slimSnapshotForStorage } from '@/lib/marketSnapshotFallback';",
    ].join('\n'),
    resolveDir: root, loader: 'ts', sourcefile: 'harvest-app.ts',
  },
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  packages: 'external', outfile, plugins: [aliasPlugin], logLevel: 'warning',
});
const mod = await import(pathToFileURL(outfile).href);
const api = mod.fetchOnchainMarkets ? mod : mod.default;

const cleanup = () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } };

try {
  // ── run: chain read -> authoritative AWAITED upsert of `latest` -> snapshot seed ───────────
  console.log('Reading markets from chain via the app decoder (~10-40s)…');
  const markets = await api.fetchOnchainMarkets({ force: true });
  console.log(`  read ${markets.length} markets`);
  if (markets.length === 0) { console.error('Chain read returned 0 markets — aborting so the empty set is not written.'); cleanup(); process.exit(1); }

  // fetchOnchainMarkets fires its save fire-and-forget (void). Do the CREATING upsert ourselves,
  // AWAITED, so it lands before exit. Same slim payload + same conflict target the app uses.
  const slim = api.slimSnapshotForStorage(markets);
  await api.getDb().insert(api.marketListCache)
    .values({ key: 'latest', payload: slim, updatedAt: new Date() })
    .onConflictDoUpdate({ target: api.marketListCache.key, set: { payload: slim, updatedAt: new Date() } });
  console.log('  market_list_cache: latest row written');

  // One truthful odds point per active market (mirrors the market-snapshots cron exactly). Chunked
  // to stay under D1's per-query bound-parameter limit (3 params/market).
  const rows = markets
    .filter((m) => m.status === 'Open' || m.status === 'Closing soon' || m.status === 'Closed')
    .map((m) => ({
      marketId: m.id,
      probabilities: m.outcomes.map((o) => { const odds = Number(o.odds); return Number.isFinite(odds) ? Math.min(1, Math.max(0, odds / 100)) : 0; }),
    }))
    .filter((r) => r.probabilities.length >= 2);
  let recorded = 0;
  for (let i = 0; i < rows.length; i += 30) recorded += await api.recordMarketSnapshots(rows.slice(i, i + 30));
  console.log(`  market_snapshots: seeded ${recorded} rows`);

  console.log('Done.');
} finally {
  cleanup();
}
process.exit(0);

