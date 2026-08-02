import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, '.next', 'server', 'app');

await mkdir(outputDir, { recursive: true });
await mkdir(path.join(outputDir, '_next'), { recursive: true });
await cp(path.join(root, '.next', 'static'), path.join(outputDir, '_next', 'static'), {
  recursive: true,
  force: true,
});
await rm(path.join(outputDir, '_redirects'), { force: true });
await copyFile(
  path.join(root, 'cloudflare', 'pages', 'worker.mjs'),
  path.join(outputDir, '_worker.js'),
);
