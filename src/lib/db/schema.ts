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

export const marketMetadataOverrides = pgTable('market_metadata_overrides', {
  marketId: text('market_id').primaryKey(),
  imageUri: text('image_uri').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Periodic odds snapshots per market so charts have dense, truthful history over long ranges
// (the on-chain event reconstruction only covers a short recent block window).
export const marketSnapshots = pgTable('market_snapshots', {
  marketId: text('market_id').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  /** Per-outcome implied probabilities (0..1), index-aligned with the market's outcomes. */
  probabilities: jsonb('probabilities').$type<number[]>().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.marketId, table.capturedAt] }),
}));

// Partner-registered webhook endpoints that receive market settlement events (resolved /
// canceled / proposed). Each delivery is signed with the subscription's secret (HMAC-SHA256).
export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: serial('id').primaryKey(),
  /** Owner wallet address (the signed-in creator of the subscription). */
  owner: text('owner').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  /** Event types this endpoint subscribes to, e.g. ['market_resolved','market_canceled']. */
  eventTypes: jsonb('event_types').$type<string[]>().notNull(),
  active: boolean('active').notNull().default(true),
  failureCount: integer('failure_count').notNull().default(0),
  lastStatus: text('last_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('webhook_subscriptions_owner_idx').on(table.owner),
}));

export const circleGatewayEvents = pgTable('circle_gateway_events', {
  notificationId: text('notification_id').primaryKey(),
  subscriptionId: text('subscription_id'),
  notificationType: text('notification_type').notNull(),
  eventType: text('event_type').notNull(),
  txHash: text('tx_hash'),
  walletAddress: text('wallet_address'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (table) => ({
  typeIdx: index('circle_gateway_events_type_idx').on(table.eventType),
  walletIdx: index('circle_gateway_events_wallet_idx').on(table.walletAddress),
}));
