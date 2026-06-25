import { and, desc, eq } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { limitOrders } from './db/schema';

export type LimitOrderSide = 'buy' | 'sell';
export type LimitOrderStatus = 'open' | 'filled' | 'canceled' | 'expired' | 'failed';

export type LimitOrder = {
  id: string;
  owner: string;
  marketId: string;
  outcomeIndex: number;
  outcomeLabel: string;
  side: LimitOrderSide;
  limitPriceBps: number;
  shares: string;
  slippageBps: number;
  status: LimitOrderStatus;
  createdAt: string;
  expiresAt: string | null;
  filledAt: string | null;
  txHash: string | null;
  lastError: string | null;
};

export type CreateLimitOrderInput = {
  id: string;
  owner: string;
  marketId: string;
  outcomeIndex: number;
  outcomeLabel: string;
  side: LimitOrderSide;
  limitPriceBps: number;
  shares: number;
  slippageBps?: number;
  expiresAt?: string | null;
};

/** Validate a create payload. Returns an error string, or null when valid. */
export function validateCreateLimitOrder(input: Partial<CreateLimitOrderInput>): string | null {
  if (!input.id || typeof input.id !== 'string' || input.id.length < 8 || input.id.length > 64) return 'Invalid order id.';
  if (!input.marketId || !/^0x[0-9a-fA-F]{40}$/.test(input.marketId)) return 'Invalid market address.';
  if (!Number.isInteger(input.outcomeIndex) || (input.outcomeIndex as number) < 0 || (input.outcomeIndex as number) > 11) return 'Invalid outcome.';
  if (input.side !== 'buy' && input.side !== 'sell') return 'Side must be buy or sell.';
  if (!Number.isFinite(input.limitPriceBps) || (input.limitPriceBps as number) <= 0 || (input.limitPriceBps as number) >= 10_000) return 'Limit price must be between 0 and 100c.';
  if (!Number.isFinite(input.shares) || (input.shares as number) <= 0) return 'Shares must be a positive amount.';
  if (input.slippageBps !== undefined && (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 2_000)) return 'Invalid slippage.';
  return null;
}

function rowToOrder(row: typeof limitOrders.$inferSelect): LimitOrder {
  return {
    id: row.id,
    owner: row.owner,
    marketId: row.marketId,
    outcomeIndex: row.outcomeIndex,
    outcomeLabel: row.outcomeLabel,
    side: row.side as LimitOrderSide,
    limitPriceBps: row.limitPriceBps,
    shares: row.shares,
    slippageBps: row.slippageBps,
    status: row.status as LimitOrderStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    filledAt: row.filledAt ? row.filledAt.toISOString() : null,
    txHash: row.txHash,
    lastError: row.lastError,
  };
}

export async function createLimitOrder(input: CreateLimitOrderInput): Promise<LimitOrder> {
  const db = getDb();
  const [row] = await db.insert(limitOrders).values({
    id: input.id,
    owner: input.owner.toLowerCase(),
    marketId: input.marketId.toLowerCase(),
    outcomeIndex: input.outcomeIndex,
    outcomeLabel: input.outcomeLabel.slice(0, 80),
    side: input.side,
    limitPriceBps: input.limitPriceBps,
    shares: String(input.shares),
    slippageBps: input.slippageBps ?? 200,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  }).returning();
  return rowToOrder(row);
}

export async function listOpenLimitOrders(owner: string): Promise<LimitOrder[]> {
  const db = getDb();
  const rows = await db.select().from(limitOrders)
    .where(and(eq(limitOrders.owner, owner.toLowerCase()), eq(limitOrders.status, 'open')))
    .orderBy(desc(limitOrders.createdAt))
    .limit(100);
  return rows.map(rowToOrder);
}

export async function updateLimitOrderStatus(input: {
  id: string;
  owner: string;
  status: LimitOrderStatus;
  txHash?: string | null;
  lastError?: string | null;
}): Promise<LimitOrder | null> {
  const db = getDb();
  const set: Partial<typeof limitOrders.$inferInsert> = { status: input.status };
  if (input.status === 'filled') set.filledAt = new Date();
  if (input.txHash !== undefined) set.txHash = input.txHash;
  if (input.lastError !== undefined) set.lastError = input.lastError ? input.lastError.slice(0, 300) : null;
  const [row] = await db.update(limitOrders).set(set)
    .where(and(eq(limitOrders.id, input.id), eq(limitOrders.owner, input.owner.toLowerCase())))
    .returning();
  return row ? rowToOrder(row) : null;
}

export function limitOrdersAvailable(): boolean {
  return hasDatabaseUrl();
}

// ---- pure watcher logic (unit-tested) ----

/** A buy fires when the live price falls to/below the limit; a sell when it rises to/above it. */
export function shouldTriggerLimitOrder(side: LimitOrderSide, currentPriceBps: number, limitPriceBps: number): boolean {
  if (!Number.isFinite(currentPriceBps) || !Number.isFinite(limitPriceBps)) return false;
  return side === 'buy' ? currentPriceBps <= limitPriceBps : currentPriceBps >= limitPriceBps;
}

/**
 * Slippage-guarded bound for the trade the watcher fires, derived from a fresh on-chain quote
 * (collateral units). Buy → max you'll pay (quote up by slippage); sell → min you'll receive
 * (quote down by slippage).
 */
export function limitBoundFromQuote(side: LimitOrderSide, quoteValue: number, slippageBps: number): number {
  const s = Math.max(0, slippageBps) / 10_000;
  return side === 'buy' ? quoteValue * (1 + s) : quoteValue * (1 - s);
}
