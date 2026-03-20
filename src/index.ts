import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma, connectDatabase, disconnectDatabase } from './config/database';
import { redisClient, disconnectRedis } from './config/redis';
import { getAnalyticsQueue, createQueueEvents } from './workers/analytics.queue';
import { createAnalyticsWorker } from './workers/analytics.worker';
import { UrlRepository } from './repositories/url.repository';
import { AnalyticsRepository } from './repositories/analytics.repository';

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // 1. Connect to all dependencies first
  await connectDatabase();

  // Ensure the PostgreSQL sequence for Base62 ID generation exists
  await prisma.$executeRaw`CREATE SEQUENCE IF NOT EXISTS url_seq START 1 INCREMENT 1`;

  // 2. Initialize BullMQ queue and worker
  const bullConnection = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
  };

  const analyticsQueue = getAnalyticsQueue(bullConnection);
  const queueEvents = createQueueEvents(bullConnection);

  const urlRepo = new UrlRepository(prisma);
  const analyticsRepo = new AnalyticsRepository(prisma);

  const analyticsWorker = createAnalyticsWorker(bullConnection, analyticsRepo, urlRepo);

  // 3. Create Express app
  const app = createApp({
    prismaClient: prisma,
    redisClient,
    analyticsQueue,
  });

  // 4. Start HTTP server
  const server = http.createServer(app);

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        baseUrl: env.BASE_URL,
      },
      `🚀 URL Shortener API started`,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Graceful Shutdown
  // ─────────────────────────────────────────────────────────────────────────
  // On SIGTERM (Kubernetes pod termination) or SIGINT (ctrl+c):
  //   1. Stop accepting new connections
  //   2. Wait for in-flight requests to complete (up to 30s)
  //   3. Close worker / queues
  //   4. Disconnect DB and Redis
  // ─────────────────────────────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown...');

    // Stop HTTP server (no new connections)
    server.close(async (err) => {
      if (err) logger.error({ err }, 'Error closing HTTP server');

      try {
        // Close analytics worker (finish current jobs)
        await analyticsWorker.close();
        await analyticsQueue.close();
        await queueEvents.close();

        // Disconnect data stores
        await disconnectDatabase();
        await disconnectRedis();

        logger.info('✅ Graceful shutdown complete');
        process.exit(0);
      } catch (shutdownErr) {
        logger.error({ err: shutdownErr }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Unhandled rejection safety net
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled Promise rejection');
    // Don't exit — let the process continue (log and alert)
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
