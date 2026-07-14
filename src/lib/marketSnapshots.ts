import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { marketSnapshots } from './db/schema';

export type ProbabilityPoint = {
  t: number;
  probabilities: number[];
};

// Keep ~90 days of snapshots so the table can't grow unbounded on testnet.
const SNAPSHOT_RETENTION_DAYS = 90;

/** Record one odds snapshot per market. Probabilities are 0..1, index-aligned with outcomes. */
export async function recordMarketSnapshots(
  rows: Array<{ marketId: string; probabilities: number[] }>,
): Promise<number> {
  if (!hasDatabaseUrl() || rows.length === 0) return 0;
  const db = getDb();
  const capturedAt = new Date();
  await db.insert(marketSnapshots).values(
    rows.map((row) => ({
      marketId: row.marketId.toLowerCase(),
      capturedAt,
      probabilities: row.probabilities,
    })),
  ).onConflictDoNothing();
  return rows.length;
}

/** Delete snapshots older than the retention window. Returns deleted row count (best-effort). */
export async function pruneOldSnapshots(): Promise<void> {
  if (!hasDatabaseUrl()) return;
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 86_400_000);
  await getDb().delete(marketSnapshots).where(lt(marketSnapshots.capturedAt, cutoff));
}

/** Stored snapshots for one market as chart-ready probability points (ascending time). */
export async function listMarketSnapshots(marketId: string, sinceMs?: number): Promise<ProbabilityPoint[]> {
  if (!hasDatabaseUrl()) return [];
  const where = sinceMs
    ? and(eq(marketSnapshots.marketId, marketId.toLowerCase()), gte(marketSnapshots.capturedAt, new Date(sinceMs)))
    : eq(marketSnapshots.marketId, marketId.toLowerCase());
  const rows = await getDb()
    .select()
    .from(marketSnapshots)
    .where(where)
    .orderBy(asc(marketSnapshots.capturedAt))
    .limit(2_000);
  return rows.map((row) => ({
    t: row.capturedAt.getTime(),
    probabilities: Array.isArray(row.probabilities) ? row.probabilities : [],
  }));
}

/** Count helper used by the cron response for observability. */
export async function countSnapshots(): Promise<number> {
  if (!hasDatabaseUrl()) return 0;
  const [row] = await getDb().select({ count: sql<number>`cast(count(*) as integer)` }).from(marketSnapshots);
  return row?.count ?? 0;
}
