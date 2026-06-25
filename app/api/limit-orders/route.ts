import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getSocialSession } from '@/lib/socialSession';
import {
  createLimitOrder,
  listOpenLimitOrders,
  updateLimitOrderStatus,
  validateCreateLimitOrder,
  limitOrdersAvailable,
  type LimitOrderStatus,
} from '@/lib/limitOrders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PATCH_STATUSES: LimitOrderStatus[] = ['canceled', 'filled', 'failed', 'expired'];

export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ ok: false, error: 'Sign in is required.' }, { status: 401 });
  if (!limitOrdersAvailable()) return NextResponse.json({ ok: true, orders: [] });
  try {
    const orders = await listOpenLimitOrders(session.address);
    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    console.error('[api] limit-orders GET failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not load limit orders.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('limit-orders', ip, { limit: 40, windowSec: 60 }))) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429 });
  }
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ ok: false, error: 'Sign in is required.' }, { status: 401 });
  if (!limitOrdersAvailable()) return NextResponse.json({ ok: false, error: 'Limit orders are unavailable.' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const input = {
    id: String(body.id ?? ''),
    owner: session.address,
    marketId: String(body.marketId ?? ''),
    outcomeIndex: Number(body.outcomeIndex),
    outcomeLabel: String(body.outcomeLabel ?? ''),
    side: body.side as 'buy' | 'sell',
    limitPriceBps: Number(body.limitPriceBps),
    shares: Number(body.shares),
    slippageBps: body.slippageBps === undefined ? undefined : Number(body.slippageBps),
    expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
  };
  const validationError = validateCreateLimitOrder(input);
  if (validationError) return NextResponse.json({ ok: false, error: validationError }, { status: 400 });

  try {
    const order = await createLimitOrder(input);
    return NextResponse.json({ ok: true, order }, { status: 201 });
  } catch (error) {
    console.error('[api] limit-orders POST failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not save the limit order.' }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ ok: false, error: 'Sign in is required.' }, { status: 401 });
  if (!limitOrdersAvailable()) return NextResponse.json({ ok: false, error: 'Limit orders are unavailable.' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const id = String(body.id ?? '');
  const status = body.status as LimitOrderStatus;
  if (!id) return NextResponse.json({ ok: false, error: 'Order id is required.' }, { status: 400 });
  if (!ALLOWED_PATCH_STATUSES.includes(status)) return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });

  try {
    const order = await updateLimitOrderStatus({
      id,
      owner: session.address,
      status,
      txHash: typeof body.txHash === 'string' ? body.txHash : undefined,
      lastError: typeof body.lastError === 'string' ? body.lastError : undefined,
    });
    if (!order) return NextResponse.json({ ok: false, error: 'Order not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    console.error('[api] limit-orders PATCH failed:', error);
    return NextResponse.json({ ok: false, error: 'Could not update the limit order.' }, { status: 503 });
  }
}
