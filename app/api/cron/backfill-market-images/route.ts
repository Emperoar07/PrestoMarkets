import { NextRequest, NextResponse, after } from 'next/server';
import { fetchOnchainMarkets, readMarketListSnapshot } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';
import { resolveSubjectImageUrl, brandedMarketImage } from '@/lib/marketSubjectImage';
import { validateImageUrl } from '@/lib/agentPipeline';
import { generateAiMarketImage } from '@/lib/generateAiMarketImage';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides } from '@/lib/db/schema';
import { hasGoodImage } from '@/lib/imageQuality';
import { imageUrlLoads } from '@/lib/imageLiveness';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BACKFILL_PER_RUN = 40;
// Cap AI image generations per run so the FLUX free tier isn't rate-limited; the rest get a branded
// banner this run and are retried next run (a banner isn't a "good" image, so it stays eligible).
const MAX_AI_IMAGES_PER_RUN = Math.max(0, Number(process.env.PRESTO_AI_IMAGES_PER_RUN ?? 10));

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; cron endpoints are disabled until this env var is set.' },
      { status: 500 }
    );
  }

  const auth = req.headers.get('authorization');
  if (!verifyBearer(auth, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: 'Database connection not configured' }, { status: 500 });
  }

  try {
    const db = getDb();
    // Wall-clock budget for the WHOLE route. The old budget only covered the processing loop, but
    // the forced chain read before it (and the refresh after it) each take minutes when the RPC
    // providers are degraded — runs blew past the workflow's 290s curl timeout and every scheduled
    // run went red. Everything below subtracts from this one clock.
    const routeStart = Date.now();
    const ROUTE_BUDGET_MS = 230_000;

    // 1. Market list: snapshot-first. The backfill doesn't need block-fresh data — the DB snapshot
    // (refreshed continuously by /api/markets) is instant, while a forced chain read on a cold
    // lambda takes 30-150s+ depending on RPC health. Fall back to the chain only without a usable
    // snapshot.
    const snapshot = await readMarketListSnapshot();
    let allMarkets;
    if (snapshot && snapshot.markets.length > 0 && snapshot.ageMs < 30 * 60 * 1000) {
      allMarkets = snapshot.markets;
    } else {
      try {
        allMarkets = await fetchOnchainMarkets({ force: true });
      } catch (chainError) {
        // Every RPC leg can fail at once when all providers are out of credit and the public
        // endpoint is rate-limited. A stale snapshot beats a 500: image work doesn't need
        // block-fresh data, and the run keeps the workflow green until an endpoint recovers.
        if (snapshot && snapshot.markets.length > 0) {
          logger.warn('backfill-market-images', 'chain read failed; using stale snapshot', {
            ageMs: snapshot.ageMs,
            error: chainError instanceof Error ? chainError.message.slice(0, 160) : String(chainError),
          });
          allMarkets = snapshot.markets;
        } else {
          throw chainError;
        }
      }
    }

    // Markets whose stored override is ALREADY a good image — skip these so we don't reprocess
    // them every run. Crucially, a market whose override is only a branded-SVG fallback stays
    // eligible, so we keep retrying for a real subject image instead of freezing it on the banner.
    const overrideRows = await db
      .select({ id: marketMetadataOverrides.marketId, imageUri: marketMetadataOverrides.imageUri })
      .from(marketMetadataOverrides);
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
      return NextResponse.json({
        ok: true,
        message: 'No agent markets needing an image refresh.',
        processedCount: 0,
        updates: [],
      });
    }

    // Slice to cap per run to avoid rate limits or timeouts. Needs-image markets take priority;
    // upgrade candidates fill the remaining budget.
    const batch = [...targetMarkets, ...upgradeCandidates].slice(0, MAX_BACKFILL_PER_RUN);
    const updates: Array<{ id: string; title: string; imageURI: string }> = [];
    let aiGenerated = 0;

    // Stop the loop early and return partial progress instead of running into Vercel's kill (which
    // silently loses queued writes); the next run picks up the remainder. Reserve a little headroom
    // for the response itself.
    for (const market of batch) {
      if (Date.now() - routeStart > ROUTE_BUDGET_MS - 10_000) break;
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
        if (!finalImage && aiGenerated < MAX_AI_IMAGES_PER_RUN) {
          aiGenerated += 1;
          finalImage = (await generateAiMarketImage({ title: market.title, category: market.category })) ?? undefined;
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

    // Rebuild the market cache/snapshot so overridden images take effect on next load — AFTER the
    // response, so a slow chain read can't push this run past the workflow's curl timeout.
    after(async () => { await fetchOnchainMarkets({ force: true }).catch(() => null); });

    return NextResponse.json({
      ok: true,
      processedCount: updates.length,
      remainingCount: Math.max(0, targetMarkets.length - batch.length),
      updates,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Backfill failed' },
      { status: 500 }
    );
  }
}
