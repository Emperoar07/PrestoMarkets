import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { getSocialSession } from '@/lib/socialSession';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookSubscriptions,
  type WebhookEventType,
} from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_EVENTS: WebhookEventType[] = ['market_resolved', 'market_canceled', 'resolution_proposed'];

export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  try {
    return NextResponse.json({ subscriptions: await listWebhookSubscriptions(session.address) });
  } catch (error) {
    console.error('[api] webhooks GET failed:', error);
    return NextResponse.json({ error: 'Webhooks are unavailable.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('webhooks-write', ip, { limit: 10, windowSec: 60 }))) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  let body: { url?: unknown; eventTypes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const eventTypes = Array.isArray(body.eventTypes)
    ? body.eventTypes.filter((e): e is WebhookEventType => VALID_EVENTS.includes(e as WebhookEventType))
    : [];
  if (!url) return NextResponse.json({ error: 'A webhook url is required.' }, { status: 400 });
  if (eventTypes.length === 0) {
    return NextResponse.json({ error: `eventTypes must include at least one of: ${VALID_EVENTS.join(', ')}.` }, { status: 400 });
  }

  try {
    const { id, secret } = await createWebhookSubscription({ owner: session.address, url, eventTypes });
    // The secret is returned exactly once, here, so the partner can verify the HMAC signature.
    return NextResponse.json({ id, secret, eventTypes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create webhook.';
    // URL validation / SSRF rejections are client errors; everything else is a 503.
    const isClientError = /url|public|https?/i.test(message);
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'A valid webhook id is required.' }, { status: 400 });
  }
  try {
    const removed = await deleteWebhookSubscription(session.address, id);
    if (!removed) return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] webhooks DELETE failed:', error);
    return NextResponse.json({ error: 'Could not delete webhook.' }, { status: 503 });
  }
}
