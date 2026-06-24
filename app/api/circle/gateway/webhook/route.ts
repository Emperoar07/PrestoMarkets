import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { recordCircleGatewayWebhook } from '@/lib/circleGatewayWebhooks';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getClientIp } from '@/lib/requestGuards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyWebhookSecret(request: NextRequest, rawBody: string): boolean {
  const secret = process.env.CIRCLE_GATEWAY_WEBHOOK_SECRET;
  if (!secret) return true;

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (bearer && safeEqual(bearer, secret)) return true;

  const staticSecret = request.headers.get('x-presto-webhook-secret')?.trim();
  if (staticSecret && safeEqual(staticSecret, secret)) return true;

  const signature = request.headers.get('x-circle-signature')
    ?? request.headers.get('circle-signature')
    ?? request.headers.get('x-webhook-signature')
    ?? request.headers.get('x-presto-signature');
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const normalized = signature.replace(/^sha256=/i, '').trim();
  return safeEqual(normalized, expected);
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
  if (!verifyWebhookSecret(request, rawBody)) {
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
