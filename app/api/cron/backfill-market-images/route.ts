import { NextRequest, NextResponse } from 'next/server';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { verifyBearer } from '@/lib/authCompare';
import { resolveSubjectImageUrl } from '@/lib/marketSubjectImage';
import { validateImageUrl } from '@/lib/agentPipeline';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BACKFILL_PER_RUN = 12;

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

    // 2. Identify agent markets without images
    const targetMarkets = allMarkets.filter(
      (m) =>
        m.createdByType === 'agent' &&
        (!m.imageURI || m.imageURI.trim().length === 0)
    );

    if (targetMarkets.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No agent markets without images found.',
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

        if (imageCandidate) {
          const validated = await validateImageUrl(imageCandidate, market.title);
          if (validated) {
            // Write/upsert image override to database
            await db
              .insert(marketMetadataOverrides)
              .values({
                marketId: market.id.toLowerCase(),
                imageUri: validated,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: marketMetadataOverrides.marketId,
                set: { imageUri: validated, updatedAt: new Date() },
              });

            updates.push({
              id: market.id,
              title: market.title,
              imageURI: validated,
            });
          }
        }
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
