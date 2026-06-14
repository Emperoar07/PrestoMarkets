import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';
import { resolveSubjectImageUrl, brandedMarketImage } from '@/lib/marketSubjectImage';
import { validateImageUrl } from '@/lib/agentPipeline';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BACKFILL_PER_RUN = 40;

// Hosts we trust to serve a working image; anything else (or a branded fallback / empty) is a
// candidate to re-resolve a real subject image.
const TRUSTED_IMG_HOSTS = [
  'assets.coingecko.com', 'coin-images.coingecko.com', 'flagcdn.com', 'upload.wikimedia.org',
  'r2.thesportsdb.com', 'www.thesportsdb.com', 'thesportsdb.com', 'a.espncdn.com', 'a1.espncdn.com',
];
function hasGoodImage(uri: string | undefined): boolean {
  if (!uri || uri.trim().length === 0) return false;
  const v = uri.trim();
  if (v.startsWith('data:image/svg+xml')) return false; // branded fallback — upgrade if possible
  if (v.startsWith('data:')) return true; // a real data-image payload is fine
  try {
    const host = new URL(v).hostname.toLowerCase();
    return TRUSTED_IMG_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

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
    // 1. Fetch current onchain markets
    const allMarkets = await fetchOnchainMarkets({ force: true });

    // Markets we've already stored an override for — skip them so we don't reprocess every run
    // (and so a stored branded fallback isn't endlessly re-resolved).
    const overridden = new Set(
      (await db.select({ id: marketMetadataOverrides.marketId }).from(marketMetadataOverrides))
        .map((r) => r.id.toLowerCase()),
    );

    // 2. Identify agent markets that lack a GOOD image — empty, a branded SVG fallback, or a
    //    non-trusted-host URL (likely stale/broken and showing the card placeholder).
    const targetMarkets = allMarkets.filter(
      (m) => m.createdByType === 'agent'
        && !hasGoodImage(m.imageURI)
        && !overridden.has(m.id.toLowerCase()),
    );

    if (targetMarkets.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No agent markets needing an image refresh.',
        processedCount: 0,
        updates: [],
      });
    }

    // Slice to cap per run to avoid rate limits or timeouts
    const batch = targetMarkets.slice(0, MAX_BACKFILL_PER_RUN);
    const updates: Array<{ id: string; title: string; imageURI: string }> = [];

    for (const market of batch) {
      try {
        // Resolve subject image using the same pipeline helpers (e.g. flag, coin logo, SportsDB, Wikipedia)
        const imageCandidate = await resolveSubjectImageUrl({
          topic: market.title,
          query: market.description,
        });
        const validated = imageCandidate ? await validateImageUrl(imageCandidate, market.title) : undefined;
        // Guarantee an image: fall back to a branded banner when no real subject image resolves.
        const finalImage = validated || brandedMarketImage(market.title);

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

    // Clear memory cache so the overridden images take effect immediately on next load
    // (force: true on fetchOnchainMarkets will rebuild the cache)
    await fetchOnchainMarkets({ force: true }).catch(() => null);

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
