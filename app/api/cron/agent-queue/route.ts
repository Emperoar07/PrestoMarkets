/**
 * Cron Job: Autonomous Agent Queue Processing
 *
 * Triggered by: Vercel Cron (scheduled in vercel.json)
 * Frequency: Every 10 minutes (configurable)
 * Purpose: Process pending market creation requests from queue
 *
 * Security: Requires CRON_SECRET header
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPendingQueue, getOrchestratorHealth } from '@/lib/agentOrchestrator';
import { getQueueMetrics, purgeCompleted } from '@/lib/agentQueue';
import { logger } from '@/lib/logger';
import { verifyBearer } from '@/lib/authCompare';

// No `maxDuration` — a Vercel route-segment directive, and a no-op under @opennextjs/cloudflare (see
// scripts/prepare-cloudflare-workers.mjs for the real Workers CPU limit, which is what binds here).

async function verifyCronSecret(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    logger.error('cron-queue', 'CRON_SECRET not configured');
    return false;
  }

  const authHeader = req.headers.get('authorization') || '';
  return verifyBearer(authHeader, cronSecret);
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  if (!(await verifyCronSecret(req))) {
    logger.warn('cron-queue', 'Unauthorized cron request');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const cronStartTime = Date.now();

  try {
    logger.info('cron-queue', 'Starting autonomous queue processing');

    // Phase 1: Purge old completed items (keep 24 hours of history)
    const purgedCount = purgeCompleted(24 * 60 * 60 * 1000);
    logger.info('cron-queue', `Purged ${purgedCount} old queue items`);

    // Phase 2: Check orchestrator health
    const metrics = getQueueMetrics();
    const health = getOrchestratorHealth(metrics);

    if (health.status === 'error') {
      logger.error('cron-queue', 'Orchestrator in error state, skipping processing', {
        providers: health.providerHealth,
      });

      return NextResponse.json({
        success: false,
        status: 'error',
        reason: 'Orchestrator health check failed',
        health,
        metrics,
        duration: Date.now() - cronStartTime,
      });
    }

    // Phase 3: Process pending queue items
    const queueDepth = metrics.pending + metrics.retrying;

    if (queueDepth === 0) {
      logger.info('cron-queue', 'No pending queue items');

      return NextResponse.json({
        success: true,
        message: 'No pending items',
        health,
        metrics,
        duration: Date.now() - cronStartTime,
      });
    }

    logger.info('cron-queue', `Processing queue with ${queueDepth} pending items`);

    // Limit to 3 items per cron run to avoid timeout
    const processLimit = Math.min(queueDepth, 3);
    const results = await processPendingQueue(processLimit);

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;

    logger.info('cron-queue', 'Queue processing complete', {
      processed: results.length,
      successful,
      failed,
      duration: Date.now() - cronStartTime,
    });

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful,
      failed,
      health,
      metrics: getQueueMetrics(), // Updated metrics after processing
      results: results.map(r => ({
        requestId: r.requestId,
        success: r.success,
        trend: r.trend,
        duration: r.duration,
        error: r.error,
      })),
      duration: Date.now() - cronStartTime,
    });
  } catch (error) {
    const duration = Date.now() - cronStartTime;

    logger.error('cron-queue', 'Cron job failed', {
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Cron job failed',
      metrics: getQueueMetrics(),
      duration,
    }, { status: 500 });
  }
}
