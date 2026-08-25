// Off-Worker leaderboard refresh.
//
// getAllAccountStats() reconstructs EVERY account's ledger from on-chain event logs — the heaviest
// read in the app. On the Workers Free plan that exceeds the fixed CPU ceiling, and the resulting
// kill is uncatchable: the old on-Worker route's Promise.race/150s-timeout fallback could never
// actually fire, so the endpoint 500'd and agent-tick's strict leaderboard step turned red on every
// single 2-hourly run (~12 failed runs, and ~12 notification emails, per day).
//
// Here the same computation runs in plain Node with no CPU ceiling, and writes the leaderboard_cache
// rows to D1 over REST. The app then only ever READS that table (listLeaderboard), which is cheap.
//
//   node scripts/refresh-leaderboard.mjs
//
// Requires CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (from .env.local locally, repository secrets in CI)
// plus whatever RPC config the chain read needs. Secrets are never printed.
import { loadEnvLocal, installD1Shim, bundleAppModules } from './lib/offworker.mjs';

loadEnvLocal();
installD1Shim();

const { api, cleanup } = await bundleAppModules([
  "export { getAllAccountStats } from '@/lib/marketIndexer';",
  "export { refreshLeaderboardCache } from '@/lib/socialDb';",
], '.leaderboard-tmp');

try {
  console.log('Reconstructing account ledgers from chain logs (no CPU ceiling out here)…');
  const stats = await api.getAllAccountStats();
  console.log(`  computed stats for ${stats.length} account(s)`);

  // Writing an empty set would blank a good leaderboard on a transient RPC failure. refreshLeaderboardCache
  // already returns [] for an empty input, but bail loudly so CI shows why nothing was written.
  if (stats.length === 0) {
    console.error('Stats computation returned 0 accounts — refusing to write an empty leaderboard.');
    process.exitCode = 1;
  } else {
    const rows = await api.refreshLeaderboardCache(stats, 'all');
    console.log(`  leaderboard_cache: wrote ${rows.length} row(s)`);
    console.log('Done.');
  }
} finally {
  cleanup();
}

// Explicit exit, as scripts/harvest-d1-snapshot.mjs does: the chain read leaves RPC sockets and
// provider timers open, and Node will not exit while they are alive. Without this the CI job hangs
// until its timeout and reports failure even though the write already succeeded.
process.exit(process.exitCode ?? 0);
