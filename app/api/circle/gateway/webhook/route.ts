import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { recordCircleGatewayWebhook } from '@/lib/circleGatewayWebhooks';
import { verifyCircleWebhookSignature } from '@/lib/circleWebhookVerify';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getClientIp } from '@/lib/requestGuards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Optional shared-secret fallback for manual/testnet delivery (a proxy that forwards Circle events
// with a static bearer). Genuine Circle webhooks authenticate via the ECDSA signature above.
function matchesSharedSecret(request: NextRequest): boolean {
  const secret = process.env.CIRCLE_GATEWAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (bearer && safeEqual(bearer, secret)) return true;
  const staticSecret = request.headers.get('x-presto-webhook-secret')?.trim();
  return Boolean(staticSecret && safeEqual(staticSecret, secret));
}

// Authenticate the webhook: Circle's real asymmetric ECDSA signature first (X-Circle-Signature +
// X-Circle-Key-Id), then the optional shared-secret fallback. Fails closed.
async function isAuthenticWebhook(request: NextRequest, rawBody: string): Promise<boolean> {
  const sig = await verifyCircleWebhookSignature(request.headers, rawBody);
  if (sig === 'valid') return true;
  // A present-but-invalid Circle signature is a hard reject — do NOT let the shared-secret path
  // rescue a forged/tampered Circle-signed payload.
  if (sig === 'invalid') return false;
  return matchesSharedSecret(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
    },
  });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('circle-gateway-webhook', ip, { limit: 120, windowSec: 60, failOpen: true }))) {
    return NextResponse.json({ error: 'Too many webhook requests.' }, { status: 429 });
  }

  const rawBody = await request.text();
  if (!(await isAuthenticWebhook(request, rawBody))) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await recordCircleGatewayWebhook(body);
    // skipped = the event could NOT be recorded (no DATABASE_URL). Answer 503 — a non-2xx makes
    // Circle retry the delivery, so the event survives until the misconfiguration is fixed,
    // instead of being acked and dropped forever.
    if (result.skipped) {
      return NextResponse.json(
        { ok: false, error: 'Event store unavailable; retry later.', notificationId: result.event.notificationId },
        { status: 503, headers: { 'Retry-After': '300' } },
      );
    }
    return NextResponse.json({
      ok: true,
      inserted: result.inserted,
      skipped: result.skipped,
      notificationId: result.event.notificationId,
      eventType: result.event.eventType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gateway webhook failed.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
