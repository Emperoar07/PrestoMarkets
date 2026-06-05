import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const siweNonces = pgTable('siwe_nonces', {
  address: text('address').primaryKey(),
  nonce: text('nonce').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const cronLeases = pgTable('cron_leases', {
  key: text('key').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const commentKindEnum = pgEnum('comment_kind', ['comment', 'source_update']);
export const alertChannelEnum = pgEnum('alert_channel', ['inapp', 'email']);
export const leaderboardPeriodEnum = pgEnum('leaderboard_period', ['all', '30d']);

export const profiles = pgTable('profiles', {
  address: text('address').primaryKey(),
  handle: text('handle'),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  optInLeaderboard: boolean('opt_in_leaderboard').notNull().default(false),
  // Optional email + global opt-in for off-app (email) notification delivery.
  email: text('email'),
  emailNotifications: boolean('email_notifications').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  handleUnique: uniqueIndex('profiles_handle_unique').on(table.handle),
}));

export const notificationTypeEnum = pgEnum('notification_type', [
  'comment_reply',
  'comment_like',
  'market_resolved',
  'market_canceled',
  'system',
]);

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  address: text('address').notNull(), // recipient, lowercased
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  marketId: text('market_id'),
  link: text('link'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  byRecipient: index('notifications_address_read_created').on(table.address, table.read, table.createdAt),
}));

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  marketId: text('market_id').notNull(),
  authorAddress: text('author_address').notNull(),
  parentId: integer('parent_id'),
  body: text('body').notNull(),
  kind: commentKindEnum('kind').notNull().default('comment'),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
});

export const commentLikes = pgTable('comment_likes', {
  address: text('address').notNull(),
  commentId: integer('comment_id').references(() => comments.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.address, table.commentId] }),
}));

export const watchlist = pgTable('watchlist', {
  address: text('address').notNull(),
  marketId: text('market_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.address, table.marketId] }),
}));

export const alertPrefs = pgTable('alert_prefs', {
  address: text('address').notNull(),
  marketId: text('market_id').notNull(),
  types: jsonb('types').$type<{
    closeSoon: boolean;
    priceMove: boolean;
    resolved: boolean;
    claim: boolean;
  }>().notNull(),
  channel: alertChannelEnum('channel').notNull().default('inapp'),
}, (table) => ({
  pk: primaryKey({ columns: [table.address, table.marketId] }),
}));

export const leaderboardCache = pgTable('leaderboard_cache', {
  address: text('address').notNull(),
  period: leaderboardPeriodEnum('period').notNull(),
  realizedPnl: numeric('realized_pnl', { precision: 18, scale: 6 }).notNull().default('0'),
  marketsTraded: integer('markets_traded').notNull().default(0),
  resolvedCorrect: integer('resolved_correct').notNull().default(0),
  brier: numeric('brier', { precision: 12, scale: 6 }).notNull().default('0'),
  accuracy: numeric('accuracy', { precision: 12, scale: 6 }).notNull().default('0'),
  createdCount: integer('created_count').notNull().default(0),
  rank: integer('rank').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.address, table.period] }),
}));
