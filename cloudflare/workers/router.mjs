import { runWithCloudflareRequestContext } from '../../.open-next/cloudflare/init.js';
import { handler as middlewareHandler } from '../../.open-next/middleware/handler.mjs';

const agentRead = new Set([
  '/api/agents/graphs', '/api/agents/identity', '/api/agents/profile', '/api/agents/trends',
]);
const cronOps = new Set([
  '/api/cron/agent-fund', '/api/cron/dedupe-markets', '/api/cron/leaderboard',
  '/api/cron/market-snapshots', '/api/cron/withdraw-fees',
]);

function serverFor(pathname, env) {
  if (agentRead.has(pathname)) return env.AGENT_READ_WORKER;
  if (/^\/api\/(?:admin|agents|mcp)(?:\/|$)/.test(pathname)) return env.AGENT_WRITE_WORKER;
  if (cronOps.has(pathname)) return env.CRON_OPS_WORKER;
  if (pathname.startsWith('/api/cron/')) return env.CRON_FACTORY_WORKER;

  if (/^\/api\/markets\/[^/]+\/(?:comments|resolve-notify|trade-notify)(?:\/|$)/.test(pathname)) {
    return env.COMMUNITY_CONTENT_WORKER;
  }
  if (/^\/api\/(?:crypto|market-image|market-images|news)(?:\/|$)/.test(pathname)) return env.MEDIA_WORKER;
  if (/^\/api\/(?:markets|sports)(?:\/|$)/.test(pathname) || /^\/api\/v1\/markets(?:\/|$)/.test(pathname)) {
    return env.MARKET_DATA_WORKER;
  }
  if (/^\/api\/(?:auth|circle)(?:\/|$)/.test(pathname) || pathname === '/api/webhooks') return env.AUTH_WORKER;
  if (/^\/api\/(?:activity|comments|leaderboard)(?:\/|$)/.test(pathname)
    || pathname === '/api/v1/agent' || pathname === '/api/v1/leaderboard') {
    return env.COMMUNITY_CONTENT_WORKER;
  }
  if (pathname.startsWith('/api/')) return env.COMMUNITY_ACCOUNT_WORKER;

  if (pathname.startsWith('/embed/markets/')) return env.EMBED_WORKER;
  if (pathname.startsWith('/markets/') && pathname !== '/markets/create') return env.MARKET_DETAIL_WORKER;
  if (pathname === '/admin' || pathname.startsWith('/u/')) return env.ACCOUNT_WORKER;
  if (pathname === '/world-cup') return env.WORLD_CUP_WORKER;
  if (pathname === '/') return env.SITE_HOME_WORKER;
  if (pathname === '/markets' || pathname === '/markets/create') return env.SITE_MARKETS_WORKER;
  if (pathname === '/portfolio') return env.SITE_PORTFOLIO_WORKER;
  if (pathname === '/profile' || pathname === '/watchlist') return env.SITE_PROFILE_WORKER;
  if (pathname === '/agent' || pathname === '/calibration' || pathname === '/leaderboard') {
    return env.SITE_INSIGHTS_WORKER;
  }
  return env.SITE_INFO_WORKER;
}

export default {
  async fetch(request, env, ctx) {
    return runWithCloudflareRequestContext(request, env, ctx, async () => {
      const routed = await middlewareHandler(request, env, ctx);
      if (routed instanceof Response) return routed;

      const target = serverFor(new URL(routed.url).pathname, env);
      return target.fetch(routed, { redirect: 'manual' });
    });
  },
};
