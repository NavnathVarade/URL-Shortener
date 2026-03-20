import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { AnalyticsJobPayload } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Queue (BullMQ)
// ─────────────────────────────────────────────────────────────────────────────
// Architecture:
//   Redirect handler → enqueues job → BullMQ Redis queue → Analytics Worker
//                                                          → DB write
//
// Why async? Click tracking must NOT block the redirect response.
// A p99 redirect should be <20ms. DB writes are ~5–20ms each.
// BullMQ persists jobs in Redis, so no events are lost if the DB is slow.
// ─────────────────────────────────────────────────────────────────────────────

let analyticsQueue: Queue<AnalyticsJobPayload> | null = null;

/**
 * Lazily initializes the analytics queue (producer side).
 * Reuses the existing redisBullMQ connection.
 */
export function getAnalyticsQueue(connection: { host: string; port: number; password?: string }): Queue<AnalyticsJobPayload> {
  if (analyticsQueue) return analyticsQueue;

  analyticsQueue = new Queue<AnalyticsJobPayload>(env.ANALYTICS_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },   // Keep last 1000 completed jobs for debugging
      removeOnFail: { count: 5000 },        // Keep last 5000 failed for alerting
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });

  logger.info({ queue: env.ANALYTICS_QUEUE_NAME }, 'Analytics queue initialized');
  return analyticsQueue;
}

/**
 * Enqueues an analytics event. Fire-and-forget from the caller.
 * If the queue is unavailable, logs and swallows the error.
 */
export async function enqueueAnalyticsEvent(
  queue: Queue<AnalyticsJobPayload>,
  payload: AnalyticsJobPayload,
): Promise<void> {
  try {
    await queue.add('click', payload, {
      // Jobs are best-effort — if Redis is down, we skip tracking (not blocking)
      priority: 2,
    });
  } catch (err) {
    // Non-fatal: analytics loss is acceptable; redirect must not fail
    logger.warn({ err, shortCode: payload.shortCode }, 'Failed to enqueue analytics event');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue Event Monitor (for observability)
// ─────────────────────────────────────────────────────────────────────────────

export function createQueueEvents(
  connection: { host: string; port: number; password?: string },
): QueueEvents {
  const events = new QueueEvents(env.ANALYTICS_QUEUE_NAME, { connection });

  events.on('completed', ({ jobId }) => {
    logger.debug({ jobId }, 'Analytics job completed');
  });

  events.on('failed', ({ jobId, failedReason }) => {
    logger.error({ jobId, reason: failedReason }, 'Analytics job failed');
  });

  events.on('stalled', ({ jobId }) => {
    logger.warn({ jobId }, 'Analytics job stalled');
  });

  return events;
}

export type { Queue, Worker, Job };





















