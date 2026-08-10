// Off-Worker market factory. The market-factory cron runs the agent pipeline on-Worker, but the
// Workers FREE-plan CPU + 50-subrequest ceilings make a full create-batch (trends -> LLM drafts ->
// image gen -> on-chain create + seed) unreliable there. This runs that EXACT pipeline in plain Node
// (no CPU wall, no subrequest cap, sharp available) by driving the app's own runAgentPipeline through
// a D1-over-REST shim, then refreshes the grid snapshot so the new markets show immediately. It
// reuses the app end-to-end — no reimplementation.
//
//   node scripts/run-agent-pipeline.mjs [deadlineMinutes]   # default 6
//
// Creates REAL markets on Arc Testnet with the agent wallet (AGENT_PRIVATE_KEY) and spends testnet
// USDC to seed them. Secrets are read from .env.local and never printed.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const DB_ID = '20b734c5-71f3-46b0-97ec-578fd203c112';
const TMP_DIR = path.join(root, '.pipeline-tmp');
const deadlineMin = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 6;

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
if (!process.env.AGENT_PRIVATE_KEY) { console.error('Missing AGENT_PRIVATE_KEY in .env.local — cannot create markets.'); process.exit(1); }

// ── D1-over-REST shim implementing the drizzle-orm/d1 binding contract (same as harvest) ─────
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
// ── bundle the app's real pipeline (resolves the @/ alias + strips TS) ───────────────────────
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
      "export { runAgentPipeline } from '@/lib/agentPipeline';",
      "export { appendNewMarketsToSnapshot } from '@/lib/onchainMarkets';",
    ].join('\n'),
    resolveDir: root, loader: 'ts', sourcefile: 'pipeline-app.ts',
  },
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  packages: 'external', outfile, plugins: [aliasPlugin], logLevel: 'warning',
});
const mod = await import(pathToFileURL(outfile).href);
const api = mod.runAgentPipeline ? mod : mod.default;

const cleanup = () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } };

try {
  // ── run: full create batch with a generous Node deadline (no CPU wall off-Worker) ──────────
  console.log(`Running agent pipeline (deadline ${deadlineMin}m)… trends -> drafts -> images -> on-chain create + seed.`);
  const results = await api.runAgentPipeline({ deadlineMs: Date.now() + deadlineMin * 60_000 });

  const created = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  console.log(`\n── created ${created.length} · rejected ${rejected.length} ──`);
  for (const r of created) console.log(`  ✓ ${r.topic}  ${r.txHash}`);
  for (const r of rejected) console.log(`  ✗ ${r.topic}  [${r.stage}] ${r.reason}`);

  // Mirror the route's after(): make the fresh markets visible on the grid without waiting for the
  // next full harvest. Bounded incremental ingest into market_list_cache.
  if (created.length > 0) {
    console.log('\nRefreshing grid snapshot with the new markets…');
    const n = await api.appendNewMarketsToSnapshot().catch((e) => { console.warn('  snapshot refresh failed:', e?.message ?? e); return 0; });
    console.log(`  snapshot: appended ${n ?? 0} new market(s)`);
  }
  console.log('\nDone.');
} finally {
  cleanup();
}
process.exit(0);

