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

// App-level market flags. 'frozen' blocks trading in the UI for decided markets whose deployed
// contract offers no pause/early-cancel (old V1/V2) — written by the pause-decided-markets cron,
// merged into the market list by the reader, enforced by placeTrade + the trade panels.
export const marketFlags = pgTable('market_flags', {
  marketId: text('market_id').primaryKey(),
  flag: text('flag').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Latest full market-list snapshot (single row, key='latest'). Serverless instances are often cold
// (no in-process cache) and the full on-chain read takes 10-30s — the skeleton screen users see on
// load. Serving this snapshot instead takes ~300ms; a background refresh keeps it current.
export const marketListCache = pgTable('market_list_cache', {
  key: text('key').primaryKey(),
  payload: jsonb('payload').notNull(),
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

// Client-watched limit orders for V3 LMSR markets. The server only stores intent; a client-side
// watcher polls the live price and fires the trade through the user's wallet when the limit is hit.
export const limitOrderStatusEnum = pgEnum('limit_order_status', ['open', 'filled', 'canceled', 'expired', 'failed']);

export const limitOrders = pgTable('limit_orders', {
  id: text('id').primaryKey(), // uuid (client-generated)
  owner: text('owner').notNull(), // lowercased wallet address
  marketId: text('market_id').notNull(), // lowercased market contract address
  outcomeIndex: integer('outcome_index').notNull(),
  outcomeLabel: text('outcome_label').notNull(),
  side: text('side').notNull(), // 'buy' | 'sell'
  limitPriceBps: integer('limit_price_bps').notNull(), // 0..10000 (e.g. 4500 = 45c)
  shares: numeric('shares', { precision: 24, scale: 6 }).notNull(),
  slippageBps: integer('slippage_bps').notNull().default(200),
  status: limitOrderStatusEnum('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  filledAt: timestamp('filled_at', { withTimezone: true }),
  txHash: text('tx_hash'),
  lastError: text('last_error'),
}, (table) => ({
  ownerStatusIdx: index('limit_orders_owner_status_idx').on(table.owner, table.status),
  marketStatusIdx: index('limit_orders_market_status_idx').on(table.marketId, table.status),
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
