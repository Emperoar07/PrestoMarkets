import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflarePageShards, cloudflareRouteShards } from './cloudflare-route-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cloudflare-build');
const workers = path.join(out, 'workers');
const compatibilityFlags = ['nodejs_compat', 'allow_importable_env', 'global_fetch_strictly_public'];

// Shared D1 binding — every shard and the router bind the same database so `getDb()` resolves it
// via getCloudflareContext() regardless of which Worker serves the request. The id is the D1
// database's UUID (an identifier, not a secret).
const d1Databases = [
  { binding: 'DB', database_name: 'presto-markets-db', database_id: '20b734c5-71f3-46b0-97ec-578fd203c112' },
];

// NOTE: raising per-shard CPU with `limits.cpu_ms` requires the Workers PAID plan — the Free plan
// rejects it (API error 100328) AND enforces a fixed CPU ceiling that the full on-chain read
// (factory scan + trade-log decode across all markets) exceeds. That is why D1's marketListCache
// cannot self-populate on the free plan: the read that writes it is CPU-killed. Until the account
// is on a paid plan, D1 is populated by an OFF-Worker harvest (scripts/harvest-d1-snapshot.mjs)
// and kept fresh by the bounded ingest-markets cron, which does fit the free CPU budget.

export const services = [
  ['agentRead', 'presto-markets-agent-read'],
  ['agentWrite', 'presto-markets-agent-write'],
  ['cronFactory', 'presto-markets-cron-factory'],
  ['cronOps', 'presto-markets-cron-ops'],
  ['marketData', 'presto-markets-market-data'],
  ['media', 'presto-markets-media'],
  ['auth', 'presto-markets-auth'],
  ['communityContent', 'presto-markets-community-content'],
  ['communityAccount', 'presto-markets-community-account'],
  ['siteHome', 'presto-markets-site-home'],
  ['siteMarkets', 'presto-markets-site-markets'],
  ['sitePortfolio', 'presto-markets-site-portfolio'],
  ['siteInfo', 'presto-markets-site-info'],
  ['siteInsights', 'presto-markets-site-insights'],
  ['siteProfile', 'presto-markets-site-profile'],
  ['marketDetail', 'presto-markets-market-detail'],
  ['embed', 'presto-markets-embed'],
  ['account', 'presto-markets-account'],
];

const configuredShards = new Set(services.map(([shard]) => shard));
const routedShards = new Set(Object.keys(cloudflareRouteShards));
if (configuredShards.size !== routedShards.size || [...configuredShards].some((shard) => !routedShards.has(shard))) {
  throw new Error('Cloudflare service configuration is out of sync with the route shard map.');
}

await rm(out, { recursive: true, force: true });
await mkdir(workers, { recursive: true });

for (const [shard, workerName] of services) {
  const servesPages = cloudflarePageShards.has(shard);
  const entry = `import { runWithCloudflareRequestContext } from '../../.open-next/cloudflare/init.js';
import { handler } from '../../.open-next/server-functions/${shard}/handler.mjs';

export default {
  fetch(request, env, ctx) {
    return runWithCloudflareRequestContext(request, env, ctx, () => handler(request, env, ctx));
  },
};
`;
  await writeFile(path.join(workers, `${shard}.mjs`), entry);
  const workerConfig = {
    name: workerName,
    main: `workers/${shard}.mjs`,
    compatibility_date: '2026-08-02',
    compatibility_flags: compatibilityFlags,
    workers_dev: false,
    observability: { enabled: true },
    placement: { mode: 'smart' },
    services: [{ binding: 'WORKER_SELF_REFERENCE', service: workerName }],
    d1_databases: d1Databases,
  };
  if (servesPages) workerConfig.assets = { directory: '../.open-next/assets', binding: 'ASSETS' };
  await writeFile(path.join(out, `wrangler.${shard}.json`), JSON.stringify(workerConfig, null, 2));
}

const bindings = services.map(([shard, service]) => ({
  binding: `${shard.replace(/([A-Z])/g, '_$1').toUpperCase()}_WORKER`,
  service,
}));
await writeFile(path.join(out, 'wrangler.router.json'), JSON.stringify({
  name: 'presto-markets-app',
  main: '../cloudflare/workers/router.mjs',
  compatibility_date: '2026-08-02',
  compatibility_flags: compatibilityFlags,
  workers_dev: true,
  assets: { directory: '../.open-next/assets', binding: 'ASSETS' },
  services: bindings,
  d1_databases: d1Databases,
  observability: { enabled: true },
  placement: { mode: 'smart' },
}, null, 2));

console.log(`Prepared ${services.length} service Workers and the public router.`);
