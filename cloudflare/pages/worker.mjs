const UPSTREAM_ORIGIN = 'https://presto-markets-app.bolajilateef07.workers.dev';

const STATIC_ASSET_PATH = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|webp|woff2?)$/i;
const MARKET_LIST_PATH = '/api/markets';

function isStaticAsset(request, pathname) {
  return (request.method === 'GET' || request.method === 'HEAD')
    && (pathname.startsWith('/_next/static/') || STATIC_ASSET_PATH.test(pathname));
}

function responseWithHeaders(response, additions) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additions)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isHtmlFallbackForAsset(request, response) {
  if (request.method === 'HEAD') return false;
  const contentType = response.headers.get('Content-Type') || '';
  return response.ok && contentType.toLowerCase().includes('text/html');
}

async function fetchMarketList(request, upstreamRequest, ctx) {
  const cache = globalThis.caches?.default;
  if (!cache) return fetch(upstreamRequest);

  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return responseWithHeaders(cached, {
      'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=120',
      'X-Presto-Edge-Cache': 'HIT',
    });
  }

  const response = await fetch(upstreamRequest);
  if (response.ok) {
    const cacheable = responseWithHeaders(response.clone(), {
      'Cache-Control': 'public, max-age=30',
      'X-Presto-Edge-Cache': 'HIT',
    });
    const write = cache.put(cacheKey, cacheable);
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }
  return responseWithHeaders(response, { 'X-Presto-Edge-Cache': 'MISS' });
}

export default {
  async fetch(request, env, ctx) {
    const incoming = new URL(request.url);

    // Pages owns immutable browser assets. Everything dynamic is handled by the
    // route-sharded OpenNext Workers, including API routes and HTML documents.
    if (isStaticAsset(request, incoming.pathname) && env?.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404 && !isHtmlFallbackForAsset(request, asset)) {
        return responseWithHeaders(asset, {
          'Cache-Control': incoming.pathname.startsWith('/_next/static/')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
        });
      }
    }

    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM_ORIGIN);
    const upstreamRequest = new Request(upstream, request);
    if (request.method === 'GET' && incoming.pathname === MARKET_LIST_PATH && !incoming.search) {
      return fetchMarketList(request, upstreamRequest, ctx);
    }
    return fetch(upstreamRequest);
  },
};
