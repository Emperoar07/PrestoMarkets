/**
 * Agent Request Queue - Durable queue for market creation with Vercel KV
 * Enables: Request deduplication, fault recovery, visibility, retry logic
 *
 * Queue design:
 * - Each request gets unique ID (idempotency key)
 * - State transitions: pending → processing → completed|failed|retrying
 * - Visibility into queue depth and failure patterns
 * - Automatic retry with exponential backoff
 */

import { logger } from './logger';

export type QueueRequest = {
  id: string;
  trend: {
    topic: string;
    source: string;
    url?: string;
  };
  createdAt: string;
  retryCount: number;
  maxRetries: number;
};

export type QueueState = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export type QueueItem = {
  id: string;
  request: QueueRequest;
  state: QueueState;
  result?: any;
  error?: string;
  nextRetryAt?: string;
  updatedAt: string;
};

export type QueueMetrics = {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  avgRetries: number;
};

// In-memory queue (replace with Vercel KV in production)
const queue = new Map<string, QueueItem>();
const processing = new Set<string>();

// ── Queue Operations ────────────────────────────────────────────────────────

export function enqueueRequest(request: QueueRequest): QueueItem {
  const item: QueueItem = {
    id: request.id,
    request,
    state: 'pending',
    updatedAt: new Date().toISOString(),
  };

  queue.set(request.id, item);
  logger.info('agent-queue', `Request enqueued: ${request.id}`, {
    topic: request.trend.topic,
    retries: request.retryCount,
  });

  return item;
}

export function dequeueRequest(): QueueItem | null {
  for (const [id, item] of queue.entries()) {
    if (item.state === 'pending' || (item.state === 'retrying' && isRetryReady(item))) {
      if (!processing.has(id)) {
        item.state = 'processing';
        item.updatedAt = new Date().toISOString();
        processing.add(id);

        logger.info('agent-queue', `Request dequeued: ${item.id}`, {
          retryCount: item.request.retryCount,
        });

        return item;
      }
    }
  }

  return null;
}

export function markCompleted(requestId: string, result: any): QueueItem | null {
  const item = queue.get(requestId);
  if (!item) return null;

  item.state = 'completed';
  item.result = result;
  item.updatedAt = new Date().toISOString();
  processing.delete(requestId);

  logger.info('agent-queue', `Request completed: ${requestId}`, {
    topic: item.request.trend.topic,
  });

  return item;
}

export function markFailed(requestId: string, error: string): QueueItem | null {
  const item = queue.get(requestId);
  if (!item) return null;

  item.request.retryCount += 1;

  if (item.request.retryCount < item.request.maxRetries) {
    item.state = 'retrying';
    const backoffMs = Math.pow(2, item.request.retryCount) * 1000; // Exponential backoff
    const nextRetry = new Date(Date.now() + backoffMs);
    item.nextRetryAt = nextRetry.toISOString();

    logger.warn('agent-queue', `Request scheduled for retry: ${requestId}`, {
      retryCount: item.request.retryCount,
      nextRetryAt: item.nextRetryAt,
      error,
    });
  } else {
    item.state = 'failed';
    item.error = `Max retries (${item.request.maxRetries}) exceeded: ${error}`;

    logger.error('agent-queue', `Request failed permanently: ${requestId}`, {
      error: item.error,
    });
  }

  item.updatedAt = new Date().toISOString();
  processing.delete(requestId);

  return item;
}

// ── Query Operations ────────────────────────────────────────────────────────

export function getQueueItem(requestId: string): QueueItem | null {
  return queue.get(requestId) || null;
}

export function getQueueItems(state?: QueueState): QueueItem[] {
  const items = Array.from(queue.values());
  return state ? items.filter(item => item.state === state) : items;
}

export function getQueueMetrics(): QueueMetrics {
  const items = Array.from(queue.values());

  const metrics: QueueMetrics = {
    total: items.length,
    pending: items.filter(i => i.state === 'pending').length,
    processing: items.filter(i => i.state === 'processing').length,
    completed: items.filter(i => i.state === 'completed').length,
    failed: items.filter(i => i.state === 'failed').length,
    retrying: items.filter(i => i.state === 'retrying').length,
    avgRetries: items.length > 0
      ? items.reduce((sum, i) => sum + i.request.retryCount, 0) / items.length
      : 0,
  };

  return metrics;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

function isRetryReady(item: QueueItem): boolean {
  if (!item.nextRetryAt) return false;
  return new Date(item.nextRetryAt) <= new Date();
}

export function purgeCompleted(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let purged = 0;

  for (const [id, item] of queue.entries()) {
    if (
      (item.state === 'completed' || item.state === 'failed') &&
      new Date(item.updatedAt).getTime() < cutoff
    ) {
      queue.delete(id);
      purged++;
    }
  }

  if (purged > 0) {
    logger.info('agent-queue', `Purged ${purged} old queue items`);
  }

  return purged;
}

// ── Idempotency Key Generation ───────────────────────────────────────────────

export function generateIdempotencyKey(topic: string, source: string): string {
  const timestamp = new Date().toISOString().split('T')[0]; // Date-based grouping
  const hash = `${topic}-${source}`.toLowerCase().replace(/\s+/g, '-');
  return `${timestamp}:${hash}`.slice(0, 64);
}

// ── Dead Letter Queue ────────────────────────────────────────────────────────

export function getDeadLetterQueue(): QueueItem[] {
  return getQueueItems('failed');
}

export function resubmitDeadLetter(requestId: string, maxRetries: number = 3): QueueItem | null {
  const item = queue.get(requestId);
  if (!item || item.state !== 'failed') return null;

  item.request.retryCount = 0;
  item.request.maxRetries = maxRetries;
  item.state = 'pending';
  item.error = undefined;
  item.result = undefined;
  item.updatedAt = new Date().toISOString();

  logger.info('agent-queue', `Dead letter resubmitted: ${requestId}`, {
    topic: item.request.trend.topic,
    maxRetries,
  });

  return item;
}
