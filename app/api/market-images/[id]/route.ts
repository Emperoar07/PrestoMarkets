import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { eq } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides, marketListCache } from '@/lib/db/schema';

export const runtime = 'nodejs';

// Serves a market's stored data-URI image as real bytes. AI-generated images are 50-80KB of base64
// each; inlining them in /api/markets ballooned the list JSON past 1MB and THAT became the skeleton
// time. The list now references this endpoint instead, so the grid JSON stays small and each image
// is fetched lazily by the card and cached hard at the CDN edge.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || !isAddress(id) || !hasDatabaseUrl()) {
    return new NextResponse('Not found', { status: 404 });
  }
  try {
    const rows = await getDb()
      .select({ imageUri: marketMetadataOverrides.imageUri })
      .from(marketMetadataOverrides)
      .where(eq(marketMetadataOverrides.marketId, id.toLowerCase()))
      .limit(1);
    let uri = rows[0]?.imageUri ?? '';
    // No override row? The list's slimImages rewrites EVERY big data-URI to this endpoint —
    // including images that live on-chain in the market metadata (e.g. user-uploaded pictures),
    // not in the override store. Fall back to the market's raw image from the list snapshot so
    // those don't 404 into letter tiles.
    if (!uri.startsWith('data:image/')) {
      const snapshotRows = await getDb()
        .select({ payload: marketListCache.payload })
        .from(marketListCache)
        .where(eq(marketListCache.key, 'latest'))
        .limit(1);
      const markets = (snapshotRows[0]?.payload ?? []) as Array<{ id?: string; imageURI?: string }>;
      const market = markets.find((m) => (m.id ?? '').toLowerCase() === id.toLowerCase());
      uri = market?.imageURI ?? '';
    }
    const match = uri.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (!match) return new NextResponse('Not found', { status: 404 });
    const [, contentType, b64] = match;
    // Raster images only. SVG served inline from our origin could carry scripts (stored XSS) if a
    // malicious payload ever landed in the override store; the generator only makes JPEGs anyway.
    if (contentType.toLowerCase().includes('svg')) return new NextResponse('Not found', { status: 404 });
    const bytes = Buffer.from(b64, 'base64');
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        // Long edge cache; the list URL carries a ?v= content hash, so a regenerated image gets a
        // new URL and never fights this cache.
        'Cache-Control': 'public, max-age=3600, s-maxage=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
