import { NextResponse } from 'next/server';
import { getDb, hasDatabaseUrl } from '@/lib/db/client';
import { marketMetadataOverrides } from '@/lib/db/schema';

export const runtime = 'nodejs';

// Public read-only map of backfilled market image overrides ({ marketId: imageUri }).
// The market grid is fetched client-side (no DB access in the browser), so the client merges
// this map to display backfilled subject images.
export async function GET() {
  if (!hasDatabaseUrl()) return NextResponse.json({ images: {} });
  try {
    const rows = await getDb().select().from(marketMetadataOverrides);
    const images: Record<string, string> = {};
    for (const row of rows) images[row.marketId.toLowerCase()] = row.imageUri;
    return NextResponse.json({ images }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return NextResponse.json({ images: {} });
  }
}
