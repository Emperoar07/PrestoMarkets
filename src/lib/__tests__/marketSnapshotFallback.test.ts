// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  slimSnapshotForStorage,
  writeFilesystemSnapshot,
  readFilesystemSnapshot,
} from '../marketSnapshotFallback';
import type { AppMarket } from '../appState';

const mk = (over: Partial<AppMarket>): AppMarket => ({
  id: '0xabc',
  title: 'Test',
  status: 'Open',
  imageURI: '',
  outcomes: [],
  ...over,
} as unknown as AppMarket);

const bigDataUri = 'data:image/png;base64,' + 'A'.repeat(5000);

afterEach(() => {
  try { fs.unlinkSync(path.join(os.tmpdir(), 'presto-market-snapshot.json')); } catch { /* ignore */ }
});

describe('slimSnapshotForStorage', () => {
  it('replaces a heavy base64 image with a cacheable ref', () => {
    const [m] = slimSnapshotForStorage([mk({ id: '0xAbC', imageURI: bigDataUri })]);
    expect(m.imageURI).toMatch(/^\/api\/market-images\/0xabc\?v=/);
  });

  it('leaves branded SVGs and http/ref URLs untouched', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz4=';
    const http = 'https://a.espncdn.com/logo.png';
    const out = slimSnapshotForStorage([mk({ imageURI: svg }), mk({ imageURI: http })]);
    expect(out[0].imageURI).toBe(svg);
    expect(out[1].imageURI).toBe(http);
  });
});

describe('filesystem snapshot tier', () => {
  it('round-trips a written snapshot and slims it', () => {
    writeFilesystemSnapshot([mk({ id: '0xDEF', imageURI: bigDataUri, title: 'FS market' })]);
    const read = readFilesystemSnapshot();
    expect(read).not.toBeNull();
    expect(read!.markets).toHaveLength(1);
    expect(read!.markets[0].title).toBe('FS market');
    // stored slim, not the 5KB base64
    expect(read!.markets[0].imageURI).toMatch(/^\/api\/market-images\//);
    expect(read!.at).toBeGreaterThan(0);
  });

  it('returns null when no filesystem snapshot exists', () => {
    try { fs.unlinkSync(path.join(os.tmpdir(), 'presto-market-snapshot.json')); } catch { /* ignore */ }
    expect(readFilesystemSnapshot()).toBeNull();
  });

  it('never throws on an empty list', () => {
    expect(() => writeFilesystemSnapshot([])).not.toThrow();
  });
});
