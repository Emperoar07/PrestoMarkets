import { createHmac, randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { webhookSubscriptions } from './db/schema';
import { assertPublicHttpUrl, isSafeHttpUrl } from './publicUrl';

export type WebhookEventType = 'market_resolved' | 'market_canceled' | 'resolution_proposed';

export type WebhookEvent = {
  type: WebhookEventType;
  marketId: string;
  title: string;
  outcome?: string;
  txHash?: string;
  at: string;
};

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
// Auto-disable an endpoint after this many consecutive failures so a dead URL isn't retried forever.
const MAX_CONSECUTIVE_FAILURES = 20;

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Register a webhook. The URL is SSRF-validated before it is ever stored or called. */
export async function createWebhookSubscription(input: {
  owner: string; url: string; eventTypes: WebhookEventType[];
}): Promise<{ id: number; secret: string }> {
  if (!hasDatabaseUrl()) throw new Error('Database not configured.');
  if (!isSafeHttpUrl(input.url)) throw new Error('Webhook URL must be a public https(s) URL.');
  // Resolve + block private/loopback ranges (SSRF) before persisting.
  await assertPublicHttpUrl(input.url);

  const secret = generateWebhookSecret();
  const [row] = await getDb().insert(webhookSubscriptions).values({
    owner: input.owner.toLowerCase(),
    url: input.url,
    secret,
    eventTypes: input.eventTypes,
  }).returning({ id: webhookSubscriptions.id });
  return { id: row.id, secret };
}

export async function listWebhookSubscriptions(owner: string) {
  if (!hasDatabaseUrl()) return [];
  const rows = await getDb().select().from(webhookSubscriptions).where(eq(webhookSubscriptions.owner, owner.toLowerCase()));
  // Never return the secret on reads (it's shown once at creation only).
  return rows.map(({ secret, ...rest }) => rest);
}

export async function deleteWebhookSubscription(owner: string, id: number): Promise<boolean> {
  if (!hasDatabaseUrl()) return false;
  const deleted = await getDb().delete(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.owner, owner.toLowerCase())))
    .returning({ id: webhookSubscriptions.id });
  return deleted.length > 0;
}

async function deliver(sub: { id: number; url: string; secret: string; failureCount: number }, event: WebhookEvent): Promise<void> {
  const body = JSON.stringify(event);
  const signature = sign(sub.secret, body);
  let lastStatus = 'unsent';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Re-validate the URL each delivery (DNS can change → SSRF); fetchPublicHttpUrl would be
      // ideal but we need POST + headers, so assert then fetch.
      await assertPublicHttpUrl(sub.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Presto-Event': event.type,
          'X-Presto-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
        // Never auto-follow redirects: a 3xx Location could point at a private/internal host that
        // the initial assertPublicHttpUrl never saw (SSRF). Treat any redirect as a failed delivery.
        redirect: 'manual',
      }).finally(() => clearTimeout(timer));
      if (res.status >= 300 && res.status < 400) {
        lastStatus = `redirect_${res.status}`;
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      lastStatus = String(res.status);
      if (res.ok) {
        await getDb().update(webhookSubscriptions)
          .set({ failureCount: 0, lastStatus })
          .where(eq(webhookSubscriptions.id, sub.id)).catch(() => undefined);
        return;
      }
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : 'error';
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  // All attempts failed — bump the failure counter and disable a chronically-dead endpoint.
  const nextFailures = sub.failureCount + 1;
  await getDb().update(webhookSubscriptions)
    .set({ failureCount: nextFailures, lastStatus, active: nextFailures < MAX_CONSECUTIVE_FAILURES })
    .where(eq(webhookSubscriptions.id, sub.id)).catch(() => undefined);
}

/**
 * Fan a settlement event out to all active subscriptions for its type. Best-effort and fully
 * isolated — a webhook outage never affects resolution. Safe to call from the auto-resolve cron.
 */
export async function dispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  if (!hasDatabaseUrl()) return;
  try {
    const subs = await getDb().select().from(webhookSubscriptions)
      .where(and(
        eq(webhookSubscriptions.active, true),
        sql`${webhookSubscriptions.eventTypes} @> ${JSON.stringify([event.type])}::jsonb`,
      ));
    await Promise.allSettled(subs.map((sub) => deliver(sub, event)));
  } catch (error) {
    console.error('[webhooks] dispatch failed:', error);
  }
}
