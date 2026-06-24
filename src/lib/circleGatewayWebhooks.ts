import { eq } from 'drizzle-orm';
import { getDb, hasDatabaseUrl } from './db/client';
import { circleGatewayEvents } from './db/schema';
import { isRecord } from './typeGuards';

export const CIRCLE_GATEWAY_EVENT_TYPES = [
  'gateway.deposit.finalized',
  'gateway.mint.finalized',
  'gateway.mint.forwarded',
] as const;

export type CircleGatewayEventType = typeof CIRCLE_GATEWAY_EVENT_TYPES[number] | 'gateway.unknown';

export type CircleGatewayWebhook = {
  subscriptionId?: string;
  notificationId: string;
  notificationType: string;
  notification?: Record<string, unknown>;
  timestamp?: string;
  version?: number;
};

export type NormalizedCircleGatewayEvent = {
  notificationId: string;
  subscriptionId?: string;
  notificationType: string;
  eventType: CircleGatewayEventType;
  txHash?: string;
  walletAddress?: string;
  payload: Record<string, unknown>;
};

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function normalizeCircleGatewayWebhook(input: unknown): NormalizedCircleGatewayEvent {
  if (!isRecord(input)) throw new Error('Webhook body must be a JSON object.');
  const notificationId = stringField(input, ['notificationId']);
  const notificationType = stringField(input, ['notificationType', 'type']);
  if (!notificationId) throw new Error('Circle webhook is missing notificationId.');
  if (!notificationType) throw new Error('Circle webhook is missing notificationType.');

  const notification = isRecord(input.notification) ? input.notification : {};
  const eventType = (CIRCLE_GATEWAY_EVENT_TYPES as readonly string[]).includes(notificationType)
    ? notificationType as CircleGatewayEventType
    : 'gateway.unknown';
  const txHash = stringField(notification, ['txHash', 'transactionHash', 'transaction_hash']);
  const walletAddress = stringField(notification, [
    'walletAddress',
    'wallet_address',
    'depositor',
    'recipientAddress',
    'recipient',
    'destinationRecipient',
    'sourceDepositor',
  ]);

  return {
    notificationId,
    subscriptionId: stringField(input, ['subscriptionId']),
    notificationType,
    eventType,
    txHash,
    walletAddress: walletAddress?.toLowerCase(),
    payload: input,
  };
}

export async function recordCircleGatewayWebhook(input: unknown): Promise<{
  event: NormalizedCircleGatewayEvent;
  inserted: boolean;
  skipped: boolean;
}> {
  const event = normalizeCircleGatewayWebhook(input);
  if (!hasDatabaseUrl()) return { event, inserted: false, skipped: true };

  const existing = await getDb().select({ notificationId: circleGatewayEvents.notificationId })
    .from(circleGatewayEvents)
    .where(eq(circleGatewayEvents.notificationId, event.notificationId))
    .limit(1);
  if (existing.length > 0) return { event, inserted: false, skipped: false };

  await getDb().insert(circleGatewayEvents).values({
    notificationId: event.notificationId,
    subscriptionId: event.subscriptionId,
    notificationType: event.notificationType,
    eventType: event.eventType,
    txHash: event.txHash,
    walletAddress: event.walletAddress,
    payload: event.payload,
    processedAt: new Date(),
  });

  return { event, inserted: true, skipped: false };
}
