import { afterEach, describe, expect, it, vi } from 'vitest';

// The Pages entrypoint is intentionally plain ESM because Cloudflare deploys it directly.
// @ts-expect-error The runtime module does not need a TypeScript declaration file.
import pagesWorker from '../../../cloudflare/pages/worker.mjs';

describe('Cloudflare Pages proxy worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards API requests to the OpenNext router without consulting static assets', async () => {
    const upstreamFetch = vi.fn(async (request: Request) => Response.json({ ok: true, url: request.url }));
    const assetFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await pagesWorker.fetch(
      new Request('https://presto-markets.pages.dev/api/markets?status=open'),
      { ASSETS: { fetch: assetFetch } },
    );

    expect(assetFetch).not.toHaveBeenCalled();
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      ok: true,
      url: 'https://presto-markets-app.bolajilateef07.workers.dev/api/markets?status=open',
    });
  });

  it('serves browser assets from Pages without an upstream hop', async () => {
    const upstreamFetch = vi.fn();
    const assetFetch = vi.fn(async () => new Response('asset', { status: 200 }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await pagesWorker.fetch(
      new Request('https://presto-markets.pages.dev/_next/static/chunks/app.js'),
      { ASSETS: { fetch: assetFetch } },
    );

    expect(await response.text()).toBe('asset');
    expect(assetFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to the router when a requested static asset is absent', async () => {
    const upstreamFetch = vi.fn(async () => new Response('upstream', { status: 200 }));
    const assetFetch = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await pagesWorker.fetch(
      new Request('https://presto-markets.pages.dev/favicon.ico'),
      { ASSETS: { fetch: assetFetch } },
    );

    expect(await response.text()).toBe('upstream');
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('reuses a cached public market list without caching auth or admin traffic', async () => {
    const upstreamFetch = vi.fn(async () => Response.json({ markets: [] }));
    const cachedResponse = Response.json({ markets: [{ id: 'cached' }] });
    const cacheMatch = vi.fn(async () => cachedResponse);
    const cachePut = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);
    vi.stubGlobal('caches', { default: { match: cacheMatch, put: cachePut } });

    const response = await pagesWorker.fetch(
      new Request('https://presto-markets.pages.dev/api/markets'),
      { ASSETS: { fetch: vi.fn() } },
      { waitUntil: vi.fn() },
    );

    expect(await response.json()).toEqual({ markets: [{ id: 'cached' }] });
    expect(response.headers.get('X-Presto-Edge-Cache')).toBe('HIT');
    expect(cacheMatch).toHaveBeenCalledOnce();
    expect(cachePut).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
