import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { alertPrefs, comments, leaderboardCache, profiles, watchlist } from './db/schema';
import type { AccountStats } from './accountStatsStub';
import type { AlertTypes, LeaderboardMetric, LeaderboardPeriod } from './socialValidation';

export async function listComments(marketId: string) {
  return getDb()
    .select({
      id: comments.id,
      authorAddress: comments.authorAddress,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      authorHandle: profiles.handle,
      authorAvatarUrl: profiles.avatarUrl,
    })
    .from(comments)
    .leftJoin(profiles, eq(profiles.address, comments.authorAddress))
    .where(and(eq(comments.marketId, marketId), eq(comments.hidden, false)))
    .orderBy(desc(comments.createdAt))
    .limit(100);
}

export async function createComment(input: {
  marketId: string;
  authorAddress: string;
  body: string;
  parentId?: number | null;
  kind?: 'comment' | 'source_update';
}) {
  const [row] = await getDb()
    .insert(comments)
    .values({
      marketId: input.marketId,
      authorAddress: input.authorAddress,
      body: input.body,
      parentId: input.parentId ?? null,
      kind: input.kind ?? 'comment',
    })
    .returning();
  return row;
}

export async function editComment(input: {
  id: number;
  authorAddress: string;
  body: string;
}) {
  const [row] = await getDb()
    .update(comments)
    .set({ body: input.body, editedAt: new Date() })
    .where(and(
      eq(comments.id, input.id),
      eq(comments.authorAddress, input.authorAddress),
      eq(comments.hidden, false),
    ))
    .returning();
  return row ?? null;
}

export async function hideComment(input: {
  id: number;
  authorAddress: string;
}) {
  const [row] = await getDb()
    .update(comments)
    .set({ hidden: true, editedAt: new Date() })
    .where(and(
      eq(comments.id, input.id),
      eq(comments.authorAddress, input.authorAddress),
      eq(comments.hidden, false),
    ))
    .returning();
  return row ?? null;
}

export async function getProfile(address: string) {
  const [row] = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.address, address))
    .limit(1);
  return row ?? null;
}

export async function upsertProfile(input: {
  address: string;
  handle?: string | null;
  bio?: string;
  avatarUrl?: string;
  optInLeaderboard?: boolean;
}) {
  const [row] = await getDb()
    .insert(profiles)
    .values({
      address: input.address,
      handle: input.handle || null,
      bio: input.bio ?? '',
      avatarUrl: input.avatarUrl ?? '',
      optInLeaderboard: input.optInLeaderboard ?? false,
    })
    .onConflictDoUpdate({
      target: profiles.address,
      set: {
        handle: input.handle || null,
        bio: input.bio ?? '',
        avatarUrl: input.avatarUrl ?? '',
        optInLeaderboard: input.optInLeaderboard ?? false,
      },
    })
    .returning();
  return row;
}

export async function listWatchlist(address: string) {
  return getDb()
    .select()
    .from(watchlist)
    .where(eq(watchlist.address, address))
    .orderBy(desc(watchlist.createdAt));
}

export async function addWatchlistItem(address: string, marketId: string) {
  const [row] = await getDb()
    .insert(watchlist)
    .values({ address, marketId })
    .onConflictDoNothing()
    .returning();
  return row ?? { address, marketId, createdAt: new Date() };
}

export async function removeWatchlistItem(address: string, marketId: string) {
  await getDb()
    .delete(watchlist)
    .where(and(eq(watchlist.address, address), eq(watchlist.marketId, marketId)));
}

export async function getAlertPrefs(address: string, marketId: string) {
  const [row] = await getDb()
    .select()
    .from(alertPrefs)
    .where(and(eq(alertPrefs.address, address), eq(alertPrefs.marketId, marketId)))
    .limit(1);
  return row ?? null;
}

export async function upsertAlertPrefs(input: {
  address: string;
  marketId: string;
  types: AlertTypes;
  channel?: 'inapp' | 'email';
}) {
  const [row] = await getDb()
    .insert(alertPrefs)
    .values({
      address: input.address,
      marketId: input.marketId,
      types: input.types,
      channel: input.channel ?? 'inapp',
    })
    .onConflictDoUpdate({
      target: [alertPrefs.address, alertPrefs.marketId],
      set: {
        types: input.types,
        channel: input.channel ?? 'inapp',
      },
    })
    .returning();
  return row;
}

export async function listLeaderboard(input: {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
}) {
  const orderColumn =
    input.metric === 'accuracy'
      ? leaderboardCache.accuracy
      : input.metric === 'created'
        ? leaderboardCache.createdCount
        : leaderboardCache.realizedPnl;

  return getDb()
    .select()
    .from(leaderboardCache)
    .where(eq(leaderboardCache.period, input.period))
    .orderBy(desc(orderColumn), desc(leaderboardCache.updatedAt))
    .limit(100);
}

export async function refreshLeaderboardCache(stats: AccountStats[], period: LeaderboardPeriod = 'all') {
  const ranked = [...stats]
    .sort((a, b) => b.realizedPnl - a.realizedPnl || b.accuracy - a.accuracy || b.createdCount - a.createdCount)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  if (ranked.length === 0) return [];

  const rows = ranked.map((item) => ({
    address: item.address.toLowerCase(),
    period,
    realizedPnl: item.realizedPnl.toFixed(6),
    marketsTraded: item.marketsTraded,
    resolvedCorrect: item.resolvedCorrect,
    brier: item.brier.toFixed(6),
    accuracy: item.accuracy.toFixed(6),
    createdCount: item.createdCount,
    rank: item.rank,
    updatedAt: new Date(),
  }));

  return getDb()
    .insert(leaderboardCache)
    .values(rows)
    .onConflictDoUpdate({
      target: [leaderboardCache.address, leaderboardCache.period],
      set: {
        realizedPnl: sql`excluded.realized_pnl`,
        marketsTraded: sql`excluded.markets_traded`,
        resolvedCorrect: sql`excluded.resolved_correct`,
        brier: sql`excluded.brier`,
        accuracy: sql`excluded.accuracy`,
        createdCount: sql`excluded.created_count`,
        rank: sql`excluded.rank`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
    .returning();
}
