import { Worker, Job } from 'bullmq';
import { AnalyticsJobPayload } from '../types';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { UrlRepository } from '../repositories/url.repository';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Worker
// ─────────────────────────────────────────────────────────────────────────────
// Consumes click events from the BullMQ queue and persists them to PostgreSQL.
// Runs in a separate process in production (Node.js worker threads or
// dedicated ECS task), isolating DB write load from the redirect hot path.
// ─────────────────────────────────────────────────────────────────────────────

export function createAnalyticsWorker(
  connection: { host: string; port: number; password?: string },
  analyticsRepo: AnalyticsRepository,
  urlRepo: UrlRepository,
): Worker<AnalyticsJobPayload> {
  const worker = new Worker<AnalyticsJobPayload>(
    env.ANALYTICS_QUEUE_NAME,
    async (job: Job<AnalyticsJobPayload>) => {
      const { shortCode, ipAddress, userAgent, referer, country, device, clickedAt } = job.data;

      logger.debug({ shortCode, jobId: job.id }, 'Processing analytics event');

      // Parallel writes: click event + increment counter
      await Promise.all([
        analyticsRepo.createClickEvent({
          shortCode,
          ipAddress,
          userAgent,
          referer,
          country,
          device,
          clickedAt: new Date(clickedAt),
        }),
        urlRepo.incrementClickCount(shortCode),
      ]);

      logger.debug({ shortCode, jobId: job.id }, 'Analytics event processed');
    },
    {
      connection,
      concurrency: env.ANALYTICS_WORKER_CONCURRENCY,
      // Graceful shutdown: finish current jobs before stopping
      // Stalled job detection: mark job as failed if it doesn't heartbeat
      stalledInterval: 30000,
      maxStalledCount: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, shortCode: job.data.shortCode }, 'Click event recorded');
  });

  worker.on('failed', (job, err: Error) => {
    logger.error(
      { jobId: job?.id, shortCode: job?.data?.shortCode, err },
      'Analytics worker job failed',
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ err }, 'Analytics worker error');
  });

  logger.info(
    { concurrency: env.ANALYTICS_WORKER_CONCURRENCY },
    '✅ Analytics worker started',
  );

  return worker;
}
