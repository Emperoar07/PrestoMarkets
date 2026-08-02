import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflarePageShards, cloudflareRouteShards } from './cloudflare-route-shards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cloudflare-build');
const workers = path.join(out, 'workers');
const compatibilityFlags = ['nodejs_compat', 'allow_importable_env', 'global_fetch_strictly_public'];

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
  ['worldCup', 'presto-markets-world-cup'],
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
  observability: { enabled: true },
  placement: { mode: 'smart' },
}, null, 2));

console.log(`Prepared ${services.length} service Workers and the public router.`);
