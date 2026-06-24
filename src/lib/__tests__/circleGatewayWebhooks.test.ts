import { describe, expect, it } from 'vitest';
import { normalizeCircleGatewayWebhook } from '../circleGatewayWebhooks';

describe('circle gateway webhook normalization', () => {
  it('normalizes supported Gateway events with retry-safe ids', () => {
    const event = normalizeCircleGatewayWebhook({
      subscriptionId: 'sub-1',
      notificationId: 'note-1',
      notificationType: 'gateway.deposit.finalized',
      notification: {
        txHash: '0xabc',
        depositor: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD',
      },
      version: 2,
    });

    expect(event).toMatchObject({
      notificationId: 'note-1',
      subscriptionId: 'sub-1',
      notificationType: 'gateway.deposit.finalized',
      eventType: 'gateway.deposit.finalized',
      txHash: '0xabc',
      walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    });
  });

  it('keeps unknown Gateway-like events without throwing away payloads', () => {
    const event = normalizeCircleGatewayWebhook({
      notificationId: 'note-2',
      notificationType: 'gateway.future.event',
      notification: { transactionHash: '0xdef' },
    });

    expect(event.eventType).toBe('gateway.unknown');
    expect(event.payload).toMatchObject({ notificationId: 'note-2' });
  });

  it('rejects payloads without Circle retry identity', () => {
    expect(() => normalizeCircleGatewayWebhook({ notificationType: 'gateway.deposit.finalized' }))
      .toThrow(/notificationId/);
  });
});
