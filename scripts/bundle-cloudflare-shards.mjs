import { access, cp, copyFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleServer } from '../node_modules/@opennextjs/cloudflare/dist/cli/build/bundle-server.js';
import {
  compileConfig,
  getNormalizedOptions,
  nextAppDir,
} from '../node_modules/@opennextjs/cloudflare/dist/cli/commands/utils/utils.js';
import { cloudflarePageShards, cloudflareRouteShards } from './cloudflare-route-shards.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(projectRoot, '.open-next', 'server-functions');
const defaultDir = path.join(functionsDir, 'default');
const parkedDefaultDir = path.join(functionsDir, '.default-parked');
const originalWebpackRuntime = path.join(projectRoot, '.next', 'standalone', '.next', 'server', 'webpack-runtime.js');
const allShards = Object.keys(cloudflareRouteShards);
const requestedShards = process.argv.slice(2);
const unknownShards = requestedShards.filter((shard) => !allShards.includes(shard));
if (unknownShards.length > 0) throw new Error(`Unknown Cloudflare route shard(s): ${unknownShards.join(', ')}`);
const shards = requestedShards.length > 0 ? requestedShards : allShards;

const { config, buildDir } = await compileConfig();
const options = getNormalizedOptions(config, buildDir);
const projectOptions = { minify: true, sourceDir: nextAppDir };

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function findRouteFiles(directory, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findRouteFiles(file, root));
    else if (/(?:^|\/)(?:page|route)\.js$/.test(path.relative(root, file).replaceAll('\\', '/'))) files.push(path.relative(root, file));
  }
  return files;
}

const sourceAppDir = path.join(defaultDir, '.next', 'server', 'app');
const sourceRoutes = new Set((await findRouteFiles(sourceAppDir)).map((file) => file.replaceAll('\\', '/')));
const assignedRoutes = Object.values(cloudflareRouteShards).flat();
const assignedRouteSet = new Set(assignedRoutes);
const frameworkRoutes = new Set(['_global-error/page.js', '_not-found/page.js', 'icon.svg/route.js']);
const duplicateRoutes = assignedRoutes.filter((route, index) => assignedRoutes.indexOf(route) !== index);
const missingRoutes = [...sourceRoutes].filter((route) => !frameworkRoutes.has(route) && !assignedRouteSet.has(route));
const staleRoutes = assignedRoutes.filter((route) => !sourceRoutes.has(route));

if (duplicateRoutes.length > 0) throw new Error(`Routes assigned to multiple shards: ${[...new Set(duplicateRoutes)].join(', ')}`);
if (missingRoutes.length > 0) throw new Error(`Routes missing a Cloudflare shard: ${missingRoutes.join(', ')}`);
if (staleRoutes.length > 0) throw new Error(`Cloudflare shard routes missing from the build: ${staleRoutes.join(', ')}`);

async function removeUnownedRoutes(appDir, ownedRoutes, includeNotFound) {
  const keep = new Set(ownedRoutes);
  if (includeNotFound) keep.add('_not-found/page.js');

  for (const routeFile of await findRouteFiles(appDir)) {
    const normalized = routeFile.replaceAll('\\', '/');
    if (keep.has(normalized)) continue;

    const routePath = path.join(appDir, routeFile);
    const routeDir = path.dirname(routePath);
    const base = path.basename(routePath, '.js');
    for (const entry of await readdir(routeDir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name === `${base}.js` || entry.name.startsWith(`${base}_`))) {
        await rm(path.join(routeDir, entry.name), { force: true });
      }
    }
  }
}

async function pruneShard(shardDir, ownedRoutes, includeNotFound) {
  const serverDir = path.join(shardDir, '.next', 'server');
  const appDir = path.join(serverDir, 'app');
  await removeUnownedRoutes(appDir, ownedRoutes, includeNotFound);

  const routeFiles = await findRouteFiles(appDir);
  const keepChunks = new Set();
  for (const routeFile of routeFiles) {
    const traceFile = path.join(projectRoot, '.next', 'server', 'app', `${routeFile}.nft.json`);
    if (!await exists(traceFile)) continue;
    const trace = JSON.parse(await readFile(traceFile, 'utf8'));
    const traceDir = path.dirname(traceFile);
    for (const dependency of trace.files ?? []) {
      const resolved = path.resolve(traceDir, dependency);
      const chunksDir = path.join(projectRoot, '.next', 'server', 'chunks') + path.sep;
      if (resolved.startsWith(chunksDir)) keepChunks.add(path.relative(chunksDir, resolved));
    }
  }

  const chunksDir = path.join(serverDir, 'chunks');
  for (const chunk of await readdir(chunksDir, { withFileTypes: true })) {
    if (chunk.isFile() && !keepChunks.has(chunk.name)) await rm(path.join(chunksDir, chunk.name));
  }

  const manifestFile = path.join(serverDir, 'app-paths-manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const retained = Object.fromEntries(await Promise.all(Object.entries(manifest).map(async ([route, file]) => [
    route,
    await exists(path.join(serverDir, file)) ? file : null,
  ])).then((entries) => entries.filter(([, file]) => file)));
  await writeFile(manifestFile, `${JSON.stringify(retained, null, 2)}\n`);
}

for (const shard of shards) {
  const shardDir = path.join(functionsDir, shard);
  await rm(shardDir, { recursive: true, force: true });
  await cp(defaultDir, shardDir, { recursive: true });
  // The completed base bundle has an explicit switch for every chunk. Restore
  // Next's dynamic loader so OpenNext can regenerate that switch after pruning.
  await copyFile(originalWebpackRuntime, path.join(shardDir, '.next', 'server', 'webpack-runtime.js'));
  await pruneShard(shardDir, cloudflareRouteShards[shard], cloudflarePageShards.has(shard));
  await rename(defaultDir, parkedDefaultDir);
  await rename(shardDir, defaultDir);

  try {
    await bundleServer(options, projectOptions);
  } finally {
    await rename(defaultDir, shardDir);
    await rename(parkedDefaultDir, defaultDir);
  }
}
