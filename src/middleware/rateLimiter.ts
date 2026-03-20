import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Middleware
// ─────────────────────────────────────────────────────────────────────────────
// Two rate limiters:
//   1. General API rate limiter (100 req/min per IP) — applied globally
//   2. Strict shorten rate limiter (10 req/min per IP) — applied to POST /shorten
//
// In production: replace the in-memory store with a Redis store
// (express-rate-limit-redis) to share state across multiple API server instances.
// ─────────────────────────────────────────────────────────────────────────────

export const globalRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,   // Return RateLimit-* headers
  legacyHeaders: false,    // Disable X-RateLimit-* headers
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP. Please try again later.',
    },
  },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json(options.message);
  },
  skip: (req) => {
    // Skip rate limiting for health checks (used by load balancers)
    return req.path.startsWith('/health');
  },
});

export const shortenRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_SHORTEN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by IP (use X-Forwarded-For if behind a load balancer)
    return req.get('x-forwarded-for')?.split(',')[0].trim() ?? req.ip ?? 'unknown';
  },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: `You can only shorten ${env.RATE_LIMIT_SHORTEN_MAX} URLs per minute.`,
    },
  },
  handler: (req, res, _next, options) => {
    logger.warn({ ip: req.ip }, 'Shorten rate limit exceeded');
    res.status(429).json(options.message);
  },
});
