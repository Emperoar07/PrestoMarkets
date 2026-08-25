import { fetchOnchainMarkets, loadMarketListBounded } from '@/lib/onchainMarkets';
import { resolveSubjectImageUrl, brandedMarketImage } from '@/lib/marketSubjectImage';
import { validateImageUrl } from '@/lib/agentPipeline';
import { generateAiMarketImage } from '@/lib/generateAiMarketImage';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides } from '@/lib/db/schema';
import { hasGoodImage } from '@/lib/imageQuality';
import { imageUrlLoads } from '@/lib/imageLiveness';
import { logger } from '@/lib/logger';

// The image-backfill job body, extracted from app/api/cron/backfill-market-images/route.ts so it can
// run in EITHER host:
//
//   - on-Worker (the cron route) — bounded tight, because Cloudflare's Free plan enforces a fixed CPU
//     ceiling and kills the isolate when it is exceeded. That kill is NOT catchable from JS: it
//     unwinds the whole invocation, so no try/catch or Promise.race in here can convert it into a
//     graceful response. Image work (probe + decode + AI generation) is exactly the kind of load that
//     trips it, which is why this lane failed on every scheduled run.
//   - off-Worker (scripts/backfill-market-images.mjs, run from a GitHub Actions runner) — no CPU
//     ceiling at all, so the same code can process a far larger batch with a far larger budget.
//
// Keeping ONE implementation behind a budget/cap parameter is what makes the off-Worker move safe:
// there is no second copy of the policy to drift.

export type ImageBackfillUpdate = { id: string; title: string; imageURI: string };

export type ImageBackfillResult = {
  ok: boolean;
  processedCount: number;
  remainingCount?: number;
  updates: ImageBackfillUpdate[];
  /** Set when the run ended early for a non-error reason (no DB, nothing to do). */
  skipped?: string;
  detail?: string;
  message?: string;
  aiGenerated?: number;
};

export type ImageBackfillOptions = {
  /** Wall-clock budget for the whole job. */
  budgetMs?: number;
  /** Markets processed per run. */
  maxPerRun?: number;
  /** Cap on AI generations so the FLUX free tier isn't rate-limited. */
  maxAiImages?: number;
  /** Hard cap for the market-list read. */
  marketReadMs?: number;
};

const DEFAULT_MAX_AI_IMAGES = Math.max(0, Number(process.env.PRESTO_AI_IMAGES_PER_RUN ?? 10));

export async function runImageBackfill(options: ImageBackfillOptions = {}): Promise<ImageBackfillResult> {
  const {
    budgetMs = 150_000,
    maxPerRun = 40,
    maxAiImages = DEFAULT_MAX_AI_IMAGES,
    marketReadMs = 45_000,
  } = options;

  // This lane's whole job is reading+writing the overrides table, so it genuinely needs the DB.
  if (!hasDatabaseUrl()) {
    return { ok: true, processedCount: 0, updates: [], skipped: 'database-unavailable' };
  }

  const db = getDb();
  const routeStart = Date.now();

  // 1. Market list via the shared bounded loader: fresh snapshot instantly; chain read raced
  // against a hard cap otherwise (it can grind for minutes WITHOUT rejecting under RPC
  // throttling); stale snapshot as fallback — image work doesn't need block-fresh data.
  const allMarkets = await loadMarketListBounded(marketReadMs);

  // Markets whose stored override is ALREADY a good image — skip these so we don't reprocess
  // them every run. Crucially, a market whose override is only a branded-SVG fallback stays
  // eligible, so we keep retrying for a real subject image instead of freezing it on the banner.
  //
  // When the DB read fails, skip gracefully with a soft ok instead of a 500 that turns the
  // scheduled workflow red — images are attached at creation, so this upgrade pass simply resumes
  // on the next run once the DB is back.
  let overrideRows: Array<{ id: string; imageUri: string }>;
  try {
    overrideRows = await db
      .select({ id: marketMetadataOverrides.marketId, imageUri: marketMetadataOverrides.imageUri })
      .from(marketMetadataOverrides);
  } catch (dbErr) {
    return {
      ok: true,
      processedCount: 0,
      updates: [],
      skipped: 'database-unavailable',
      detail: String(dbErr instanceof Error ? dbErr.message : dbErr).slice(0, 140),
    };
  }

  // "Settled" = the stored override is a real data-image (renders unconditionally). An http-URL
  // override is NOT settled by itself — it must also pass the liveness probe below, otherwise a
  // dead trusted-host link would freeze a market on a letter tile forever.
  const settled = new Set(
    overrideRows
      .filter((r) => r.imageUri.startsWith('data:image/') && !r.imageUri.startsWith('data:image/svg'))
      .map((r) => r.id.toLowerCase()),
  );
  const everAttempted = new Set(overrideRows.map((r) => r.id.toLowerCase()));

  // 2. Identify ANY market that lacks a GOOD image (empty / branded SVG / untrusted host) — OR
  //    whose "good" trusted-host URL is actually DEAD (404/timeout → the letter-tile card). Covers
  //    both agent and user-created markets.
  const liveMarkets = allMarkets.filter(
    (m) => (m.status === 'Open' || m.status === 'Closing soon') && !settled.has(m.id.toLowerCase()),
  );
  const deadImage = new Map<string, boolean>();
  await Promise.all(liveMarkets.map(async (m) => {
    if (!hasGoodImage(m.imageURI)) return; // already eligible; skip the probe
    deadImage.set(m.id.toLowerCase(), !(await imageUrlLoads(m.imageURI)));
  }));
  const targetMarkets = liveMarkets
    .filter((m) => !hasGoodImage(m.imageURI) || deadImage.get(m.id.toLowerCase()) === true)
    // Newly created markets (never attempted) come first so they always get a slot under the
    // per-run cap; branded-fallback retries fill whatever budget remains.
    .sort((a, b) => Number(everAttempted.has(a.id.toLowerCase())) - Number(everAttempted.has(b.id.toLowerCase())));

  // UPGRADE pass (Polymarket-style policy): markets currently wearing an AI illustration get
  // re-checked for a REAL subject image (person's actual photo, project/product logo, flag,
  // crest). When one resolves and its bytes load, it replaces the AI art; when nothing real
  // resolves, the AI image stays — an upgrade candidate is never downgraded to a banner and
  // never burns AI-generation budget.
  const aiOverridden = new Set(
    overrideRows
      .filter((r) => r.imageUri.startsWith('data:image/') && !r.imageUri.startsWith('data:image/svg'))
      .map((r) => r.id.toLowerCase()),
  );
  const upgradeCandidates = allMarkets.filter(
    (m) => (m.status === 'Open' || m.status === 'Closing soon') && aiOverridden.has(m.id.toLowerCase()),
  );
  const upgradeIds = new Set(upgradeCandidates.map((m) => m.id.toLowerCase()));

  if (targetMarkets.length === 0 && upgradeCandidates.length === 0) {
    return {
      ok: true,
      processedCount: 0,
      updates: [],
      message: 'No agent markets needing an image refresh.',
    };
  }

  // Slice to cap per run to avoid rate limits or timeouts. Needs-image markets take priority;
  // upgrade candidates fill the remaining budget.
  const batch = [...targetMarkets, ...upgradeCandidates].slice(0, maxPerRun);
  const updates: ImageBackfillUpdate[] = [];
  let aiGenerated = 0;

  // Stop the loop early and return partial progress instead of running into the host's kill (which
  // silently loses queued writes); the next run picks up the remainder. Reserve a little headroom
  // for the response itself.
  for (const market of batch) {
    if (Date.now() - routeStart > budgetMs - 10_000) break;
    try {
      // Resolve subject image using the same pipeline helpers (e.g. flag, coin logo, SportsDB, Wikipedia)
      const imageCandidate = await resolveSubjectImageUrl({
        topic: market.title,
        query: market.description,
      });
      let validated = imageCandidate ? await validateImageUrl(imageCandidate, market.title) : undefined;
      // validateImageUrl trusts curated hosts WITHOUT fetching, so a dead trusted-host URL (the
      // letter-tile cause) passes it. Probe the bytes; a dead candidate falls through to AI gen.
      if (validated && /^https?:\/\//i.test(validated) && !(await imageUrlLoads(validated))) {
        validated = undefined;
      }
      // Upgrade candidates only ever move AI -> REAL: store when a real image resolved, otherwise
      // leave their AI image untouched (no banner downgrade, no AI budget spent).
      if (upgradeIds.has(market.id.toLowerCase())) {
        if (validated) {
          await db
            .insert(marketMetadataOverrides)
            .values({ marketId: market.id.toLowerCase(), imageUri: validated, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: marketMetadataOverrides.marketId,
              set: { imageUri: validated, updatedAt: new Date() },
            });
          updates.push({ id: market.id, title: market.title, imageURI: validated });
        }
        continue;
      }

      // No real subject image (flag/coin/crest/article photo)? Generate a relevant illustration
      // from the market's own context with the AI image model, instead of a generic banner. The
      // branded banner is the final fallback if generation is unavailable/fails. AI generation is
      // capped per run so the FLUX free tier isn't rate-limited — un-generated markets keep their
      // branded banner (not "good"), so they're retried on the next run until they get an image.
      let finalImage = validated;
      // AI generation chains providers at 35-40s timeouts each — a single market can burn ~150s.
      // The loop's budget check only runs BETWEEN markets, so a generation that starts late used to
      // sail past the host's kill. Only start generating when enough budget remains.
      const remainingMs = budgetMs - (Date.now() - routeStart);
      if (!finalImage && aiGenerated < maxAiImages && remainingMs > 60_000) {
        aiGenerated += 1;
        // Hard-bound the generation to the time actually left (less a response reserve): the
        // provider chain keeps trying in the background, but this run stops waiting and falls
        // back to the branded banner, leaving the market eligible for the next run.
        finalImage = (await Promise.race([
          generateAiMarketImage({ title: market.title, category: market.category }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.min(remainingMs - 20_000, 150_000))),
        ])) ?? undefined;
      }
      finalImage = finalImage || brandedMarketImage(market.title);

      await db
        .insert(marketMetadataOverrides)
        .values({ marketId: market.id.toLowerCase(), imageUri: finalImage, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: marketMetadataOverrides.marketId,
          set: { imageUri: finalImage, updatedAt: new Date() },
        });

      updates.push({ id: market.id, title: market.title, imageURI: finalImage });
    } catch (err) {
      logger.error('backfill-market-images', `Failed to backfill image for market ${market.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    processedCount: updates.length,
    remainingCount: Math.max(0, targetMarkets.length - batch.length),
    updates,
    aiGenerated,
  };
}

/**
 * Rebuild the market cache/snapshot so overridden images take effect on next load. Kept separate
 * from runImageBackfill so each host schedules it appropriately: the route defers it to after() so a
 * slow chain read can't push the run past its curl timeout, while the off-Worker script simply
 * awaits it before exiting (an unawaited promise would be lost when the process ends).
 */
export async function rebuildMarketImageCache(): Promise<void> {
  await fetchOnchainMarkets({ force: true }).catch(() => null);
}
