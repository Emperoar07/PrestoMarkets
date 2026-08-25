// Off-Worker market-image backfill.
//
// Image work — liveness probes, validation, and AI generation across dozens of markets — is exactly
// the load that trips the Workers Free-plan CPU ceiling, and that kill is uncatchable from JS. The
// on-Worker route therefore failed its strict scheduled runs (~3/day) while doing little useful work.
//
// This runs the SAME src/lib/imageBackfill.ts implementation in plain Node (no CPU ceiling), so there
// is one copy of the policy and no drift. With the ceiling gone it can afford a much larger batch and
// budget than the route's conservative on-Worker bounds.
//
//   node scripts/backfill-market-images.mjs
//
// Requires CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (from .env.local locally, repository secrets in CI)
// plus the image/RPC provider config the pipeline uses. Secrets are never printed.
import { loadEnvLocal, installD1Shim, bundleAppModules } from './lib/offworker.mjs';

loadEnvLocal();
installD1Shim();

const { api, cleanup } = await bundleAppModules([
  "export { runImageBackfill, rebuildMarketImageCache } from '@/lib/imageBackfill';",
], '.imageback-tmp');

try {
  console.log('Backfilling market images (off-Worker, no CPU ceiling)…');
  const result = await api.runImageBackfill({
    // The workflow allows 12 minutes; stay well inside it so the summary and cache rebuild still run.
    budgetMs: 420_000,
    maxPerRun: 40,
    marketReadMs: 90_000,
  });

  if (result.skipped) {
    console.log(`  skipped: ${result.skipped}${result.detail ? ` (${result.detail})` : ''}`);
  } else if (result.message) {
    console.log(`  ${result.message}`);
  } else {
    console.log(`  updated ${result.processedCount} market image(s); ${result.remainingCount ?? 0} still pending`);
    if (result.aiGenerated) console.log(`  AI illustrations generated: ${result.aiGenerated}`);
  }

  // Awaited, not fire-and-forget: an unawaited promise would be dropped when this process exits, so
  // the overridden images would not show up until something else rebuilt the snapshot.
  if (result.processedCount > 0) {
    console.log('Rebuilding the market snapshot so new images take effect…');
    await api.rebuildMarketImageCache();
  }
  console.log('Done.');
} finally {
  cleanup();
}

// Explicit exit, as scripts/harvest-d1-snapshot.mjs does: the chain read and image probes leave
// sockets and provider timers open, and Node will not exit while they are alive. Without this the CI
// job hangs until its timeout and reports failure even though the writes already succeeded.
process.exit(process.exitCode ?? 0);
