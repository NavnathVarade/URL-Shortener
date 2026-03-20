import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

import { UrlRepository } from './repositories/url.repository';
import { AnalyticsRepository } from './repositories/analytics.repository';
import { UrlService } from './services/url.service';
import { HealthService } from './services/health.service';
import { UrlController } from './controllers/url.controller';
import { HealthController } from './controllers/health.controller';
import { createUrlRouter, createHealthRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalRateLimit, shortenRateLimit } from './middleware/rateLimiter';
import { httpLogger, requestId } from './middleware/requestLogger';
import { AnalyticsJobPayload } from './types';
import { env } from './config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Application Factory
// ─────────────────────────────────────────────────────────────────────────────
// Using the factory pattern:
//   - Enables easy testing (inject test doubles)
//   - Separates app creation from server startup
//   - Supports dependency injection without an IoC container
// ─────────────────────────────────────────────────────────────────────────────

interface AppDependencies {
  prismaClient: PrismaClient;
  redisClient: Redis;
  analyticsQueue: Queue<AnalyticsJobPayload>;
}

export function createApp(deps: AppDependencies): Application {
  const app = express();

  // ─── Security Headers (Helmet) ─────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ─── CORS ──────────────────────────────────────────────────────────────────
  app.use(
    cors({
      origin: env.NODE_ENV === 'production' ? env.BASE_URL : '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'X-Short-Code'],
    }),
  );

  // ─── Trust Proxy (behind load balancer / nginx) ────────────────────────────
  app.set('trust proxy', 1);

  // ─── Request Parsing ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' }));       // Prevent large payload attacks
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // ─── Compression ───────────────────────────────────────────────────────────
  app.use(compression());

  // ─── Request ID & Logging ──────────────────────────────────────────────────
  app.use(requestId);
  app.use(httpLogger);

  // ─── Global Rate Limiting ──────────────────────────────────────────────────
  app.use(globalRateLimit);

  // ─── Dependency Wiring (manual DI) ────────────────────────────────────────
  const urlRepo = new UrlRepository(deps.prismaClient);
  const analyticsRepo = new AnalyticsRepository(deps.prismaClient);
  const urlService = new UrlService(urlRepo, analyticsRepo, deps.analyticsQueue);
  const healthService = new HealthService(deps.prismaClient, deps.redisClient, deps.analyticsQueue);

  const urlController = new UrlController(urlService);
  const healthController = new HealthController(healthService);

  // ─── Routes ────────────────────────────────────────────────────────────────

  // Health checks (no rate limiting)
  app.use('/', createHealthRouter(healthController));

  // URL routes (strict rate limit on shorten)
  const urlRouter = createUrlRouter(urlController);
  // Apply strict shorten rate limit only to POST /shorten
  app.use('/shorten', shortenRateLimit);
  app.use('/', urlRouter);

  // ─── Error Handling ────────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
