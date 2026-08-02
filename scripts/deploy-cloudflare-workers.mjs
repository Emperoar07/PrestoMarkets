import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { services } from './prepare-cloudflare-workers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, '.cloudflare-build');
const secretFile = path.join(buildDir, 'secrets.json');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const platformOnly = new Set([
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID',
  'VERCEL_TOKEN', 'VERCEL_OIDC_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT',
]);
const stage = process.argv[2] ?? 'all';
const requestedShards = process.argv.slice(3);
const selectedServices = requestedShards.length === 0
  ? services
  : services.filter(([shard]) => requestedShards.includes(shard));
const unknownShards = requestedShards.filter((shard) => !services.some(([known]) => known === shard));

if (!['all', 'services', 'router', 'secrets'].includes(stage)) {
  throw new Error(`Unknown deploy stage: ${stage}`);
}
if (unknownShards.length > 0) throw new Error(`Unknown deploy shard(s): ${unknownShards.join(', ')}`);

function wrangler(...args) {
  execFileSync(process.execPath, [wranglerBin, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
}

function parseEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || platformOnly.has(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\n/g, '\n');
  }
  return values;
}

if (stage === 'all' || stage === 'services') {
  for (const [shard] of selectedServices) {
    wrangler('deploy', '-c', path.join(buildDir, `wrangler.${shard}.json`));
  }
}

if (stage === 'all' || stage === 'router') {
  wrangler('deploy', '-c', path.join(buildDir, 'wrangler.router.json'));
}

if (stage === 'all' || stage === 'secrets') {
  const localEnv = parseEnv(await readFile(path.join(root, '.env.local'), 'utf8'));
  await writeFile(secretFile, JSON.stringify(localEnv));
  try {
    for (const [shard] of selectedServices) {
      wrangler('secret', 'bulk', secretFile, '-c', path.join(buildDir, `wrangler.${shard}.json`));
    }
  } finally {
    await rm(secretFile, { force: true });
  }
}

console.log(`Cloudflare deploy stage "${stage}" completed for ${selectedServices.length} service Worker(s).`);
