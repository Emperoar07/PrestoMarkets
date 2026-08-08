import {
  sqliteTable as table,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// D1 (SQLite) schema. Timestamp columns store Unix seconds and drizzle returns/accepts a Date
// via mode:'timestamp'. jsonb → text mode:'json' (parsed on read, stringified on write). pg enums
// → text with a TS-only `enum` option. numeric → text to preserve the exact decimal-string contract
// callers already rely on (String(row.x)). serial → integer autoincrement.
const NOW = sql`(unixepoch())`;

export const siweNonces = table('siwe_nonces', {
  address: text('address').primaryKey(),
  nonce: text('nonce').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const cronLeases = table('cron_leases', {
  key: text('key').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(NOW),
});

export const profiles = table('profiles', {
  address: text('address').primaryKey(),
  handle: text('handle'),
  bio: text('bio').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  optInLeaderboard: integer('opt_in_leaderboard', { mode: 'boolean' }).notNull().default(false),
  // Optional email + global opt-in for off-app (email) notification delivery.
  email: text('email'),
  emailNotifications: integer('email_notifications', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  handleUnique: uniqueIndex('profiles_handle_unique').on(t.handle),
}));

export const notifications = table('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull(), // recipient, lowercased
  type: text('type', {
    enum: ['comment_reply', 'comment_like', 'market_resolved', 'market_canceled', 'system'],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  marketId: text('market_id'),
  link: text('link'),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  byRecipient: index('notifications_address_read_created').on(t.address, t.read, t.createdAt),
}));

export const comments = table('comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  marketId: text('market_id').notNull(),
  authorAddress: text('author_address').notNull(),
  parentId: integer('parent_id'),
  body: text('body').notNull(),
  kind: text('kind', { enum: ['comment', 'source_update'] }).notNull().default('comment'),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
  editedAt: integer('edited_at', { mode: 'timestamp' }),
});

export const commentLikes = table('comment_likes', {
  address: text('address').notNull(),
  commentId: integer('comment_id').references(() => comments.id, { onDelete: 'cascade' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  pk: primaryKey({ columns: [t.address, t.commentId] }),
}));

export const watchlist = table('watchlist', {
  address: text('address').notNull(),
  marketId: text('market_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  pk: primaryKey({ columns: [t.address, t.marketId] }),
}));

export const alertPrefs = table('alert_prefs', {
  address: text('address').notNull(),
  marketId: text('market_id').notNull(),
  types: text('types', { mode: 'json' }).$type<{
    closeSoon: boolean;
    priceMove: boolean;
    resolved: boolean;
    claim: boolean;
  }>().notNull(),
  channel: text('channel', { enum: ['inapp', 'email'] }).notNull().default('inapp'),
}, (t) => ({
  pk: primaryKey({ columns: [t.address, t.marketId] }),
}));

export const leaderboardCache = table('leaderboard_cache', {
  address: text('address').notNull(),
  period: text('period', { enum: ['all', '30d'] }).notNull(),
  realizedPnl: text('realized_pnl').notNull().default('0'),
  marketsTraded: integer('markets_traded').notNull().default(0),
  resolvedCorrect: integer('resolved_correct').notNull().default(0),
  brier: text('brier').notNull().default('0'),
  accuracy: text('accuracy').notNull().default('0'),
  createdCount: integer('created_count').notNull().default(0),
  rank: integer('rank').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  pk: primaryKey({ columns: [t.address, t.period] }),
}));

export const marketMetadataOverrides = table('market_metadata_overrides', {
  marketId: text('market_id').primaryKey(),
  imageUri: text('image_uri').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(NOW),
});

// App-level market flags. 'frozen' blocks trading in the UI for decided markets whose deployed
// contract offers no pause/early-cancel (old V1/V2) — written by the pause-decided-markets cron,
// merged into the market list by the reader, enforced by placeTrade + the trade panels.
export const marketFlags = table('market_flags', {
  marketId: text('market_id').primaryKey(),
  flag: text('flag').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
});

// Latest full market-list snapshot (single row, key='latest'). Serverless instances are often cold
// (no in-process cache) and the full on-chain read takes 10-30s — the skeleton screen users see on
// load. Serving this snapshot instead takes ~300ms; a background refresh keeps it current.
export const marketListCache = table('market_list_cache', {
  key: text('key').primaryKey(),
  payload: text('payload', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(NOW),
});

// Confirmed-trade and periodic odds snapshots per market, used as the chart's truthful history.
export const marketSnapshots = table('market_snapshots', {
  marketId: text('market_id').notNull(),
  capturedAt: integer('captured_at', { mode: 'timestamp' }).notNull().default(NOW),
  /** Per-outcome implied probabilities (0..1), index-aligned with the market's outcomes. */
  probabilities: text('probabilities', { mode: 'json' }).$type<number[]>().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.marketId, t.capturedAt] }),
}));

// Partner-registered webhook endpoints that receive market settlement events (resolved /
// canceled / proposed). Each delivery is signed with the subscription's secret (HMAC-SHA256).
export const webhookSubscriptions = table('webhook_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Owner wallet address (the signed-in creator of the subscription). */
  owner: text('owner').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  /** Event types this endpoint subscribes to, e.g. ['market_resolved','market_canceled']. */
  eventTypes: text('event_types', { mode: 'json' }).$type<string[]>().notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  failureCount: integer('failure_count').notNull().default(0),
  lastStatus: text('last_status'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  ownerIdx: index('webhook_subscriptions_owner_idx').on(t.owner),
}));

// Client-watched limit orders for V3 LMSR markets. The server only stores intent; a client-side
// watcher polls the live price and fires the trade through the user's wallet when the limit is hit.
export const limitOrders = table('limit_orders', {
  id: text('id').primaryKey(), // uuid (client-generated)
  owner: text('owner').notNull(), // lowercased wallet address
  marketId: text('market_id').notNull(), // lowercased market contract address
  outcomeIndex: integer('outcome_index').notNull(),
  outcomeLabel: text('outcome_label').notNull(),
  side: text('side').notNull(), // 'buy' | 'sell'
  limitPriceBps: integer('limit_price_bps').notNull(), // 0..10000 (e.g. 4500 = 45c)
  shares: text('shares').notNull(),
  slippageBps: integer('slippage_bps').notNull().default(200),
  status: text('status', { enum: ['open', 'filled', 'canceled', 'expired', 'failed'] }).notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  filledAt: integer('filled_at', { mode: 'timestamp' }),
  txHash: text('tx_hash'),
  lastError: text('last_error'),
}, (t) => ({
  ownerStatusIdx: index('limit_orders_owner_status_idx').on(t.owner, t.status),
  marketStatusIdx: index('limit_orders_market_status_idx').on(t.marketId, t.status),
}));

// Durable ledger of agent-created markets, written synchronously in the creation loop.
// Cross-run dedup merges these into the "existing markets" set at run start, so a lagging
// market-list snapshot (best-effort background ingest under saturated RPCs) can never blind
// the agent into creating the same fixture twice.
export const agentCreations = table('agent_creations', {
  marketId: text('market_id').primaryKey(),
  title: text('title').notNull(),
  trendUrl: text('trend_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(NOW),
}, (t) => ({
  createdAtIdx: index('agent_creations_created_at_idx').on(t.createdAt),
}));

export const circleGatewayEvents = table('circle_gateway_events', {
  notificationId: text('notification_id').primaryKey(),
  subscriptionId: text('subscription_id'),
  notificationType: text('notification_type').notNull(),
  eventType: text('event_type').notNull(),
  txHash: text('tx_hash'),
  walletAddress: text('wallet_address'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull().default(NOW),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
}, (t) => ({
  typeIdx: index('circle_gateway_events_type_idx').on(t.eventType),
  walletIdx: index('circle_gateway_events_wallet_idx').on(t.walletAddress),
}));

// Durable cross-instance fixed-window rate limiter (middle tier between Upstash and in-memory).
// window_start is Unix seconds; the limiter compares it as a plain integer.
export const rateLimits = table('rate_limits', {
  bucket: text('bucket').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(0),
});
