import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, '.cloudflare-build', 'pages-proxy');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(path.join(root, '.open-next', 'assets'), outputDir, { recursive: true });
await copyFile(path.join(root, 'cloudflare', 'pages', 'worker.mjs'), path.join(outputDir, '_worker.js'));

execFileSync(process.execPath, [
  wranglerBin,
  'pages',
  'deploy',
  outputDir,
  '--project-name',
  'presto-markets',
  '--branch',
  'main',
  '--commit-dirty=true',
], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});
