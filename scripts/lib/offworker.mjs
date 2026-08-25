// Shared harness for OFF-WORKER jobs — the heavy work that cannot run on Cloudflare Workers.
//
// Why this exists: the Workers Free plan enforces a fixed CPU ceiling per invocation, and exceeding
// it kills the isolate in a way JS cannot catch (no try/catch, no Promise.race, no graceful 200).
// Jobs that reconstruct ledgers from event logs or decode/generate images blow straight through it,
// so every scheduled run of those lanes failed. Running the SAME app code in plain Node on a GitHub
// Actions runner removes the ceiling entirely, and writes reach D1 over its REST API.
//
// scripts/harvest-d1-snapshot.mjs pioneered this pattern; this module generalizes the three reusable
// pieces so each job script is just its own logic.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The D1 database's UUID — an identifier, not a secret.
const DB_ID = '20b734c5-71f3-46b0-97ec-578fd203c112';

/**
 * Load .env.local into process.env WITHOUT overriding values already present.
 *
 * Local runs get their config from the file; CI has no .env.local at all and instead receives the
 * same names as workflow `env:` entries sourced from repository secrets — so a missing file is a
 * normal state here, not an error.
 */
export function loadEnvLocal() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

/**
 * Install a D1-over-REST shim implementing the drizzle-orm/d1 binding contract on
 * globalThis.__D1_DB. src/lib/db/client.ts resolveBinding() falls back to exactly that global when
 * getCloudflareContext() throws (which it always does off-Worker), so the app's own getDb() — and
 * therefore every query builder written against it — works unchanged out here.
 *
 * Credentials never get printed; only their presence is reported.
 */
export function installD1Shim() {
  const account = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  if (!account || !token) {
    throw new Error(
      'Missing Cloudflare credentials. Set CF_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env.local ' +
      '(local) or as repository secrets exposed via the workflow env (CI).',
    );
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DB_ID}/query`;
  async function d1exec(sql, params) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params: params ?? [] }),
    });
    let json;
    try { json = await res.json(); } catch { throw new Error(`D1 REST non-JSON response (HTTP ${res.status})`); }
    if (!json.success) {
      throw new Error('D1 query failed: ' + ((json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`));
    }
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
}

/**
 * Bundle app modules (resolving the @/ alias, stripping TS) and import them, so off-Worker jobs reuse
 * the app's real implementations instead of reimplementing policy that would then drift.
 *
 * @param {string[]} exportLines e.g. ["export { getAllAccountStats } from '@/lib/marketIndexer';"]
 * @param {string} tmpName unique scratch dir name per job
 * @returns {Promise<{ api: any, cleanup: () => void }>}
 */
export async function bundleAppModules(exportLines, tmpName) {
  const tmpDir = path.join(root, tmpName);
  const outfile = path.join(tmpDir, 'app.cjs');
  const aliasPlugin = {
    name: 'presto-alias',
    setup(build) {
      // Stub @opennextjs/cloudflare so getCloudflareContext throws (and is caught) -> global shim used.
      build.onResolve({ filter: /^@opennextjs\/cloudflare$/ }, () => ({ path: 'cf-stub', namespace: 'cf-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({
        contents: 'export function getCloudflareContext(){throw new Error("no cf ctx off-worker");}', loader: 'js',
      }));
      // next/server is only referenced by route modules; jobs import lib code, but stub it so any
      // incidental import resolves rather than failing the bundle.
      build.onResolve({ filter: /^@\// }, (args) =>
        build.resolve('./' + args.path.slice(2), { resolveDir: path.join(root, 'src'), kind: args.kind }));
    },
  };

  await esbuild.build({
    stdin: {
      contents: exportLines.join('\n'),
      resolveDir: root, loader: 'ts', sourcefile: `${tmpName}-app.ts`,
    },
    bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    packages: 'external', outfile, plugins: [aliasPlugin], logLevel: 'warning',
  });

  const mod = await import(pathToFileURL(outfile).href);
  // CJS-through-ESM interop: depending on whether Node's named-export detection fires, the exports
  // land on the namespace, on `default`, or split across both. Merge (named winning) so callers get
  // one flat object either way — the harvest script hard-codes a single known key for this check,
  // which a shared helper can't assume.
  const fromDefault = mod && typeof mod.default === 'object' && mod.default !== null ? mod.default : {};
  const api = { ...fromDefault, ...mod };
  const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } };
  return { api, cleanup };
}
