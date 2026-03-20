import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Request ID Middleware
// ─────────────────────────────────────────────────────────────────────────────
// Assigns a unique UUID to every request for distributed tracing.
// The request ID is propagated in the X-Request-ID response header
// and included in all log lines for that request.
// ─────────────────────────────────────────────────────────────────────────────

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = req.get('x-request-id') ?? randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-ID', id);
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Request Logger (pino-http)
// ─────────────────────────────────────────────────────────────────────────────

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] as string,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'info';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (_req, _res, err) => {
    return `Request failed: ${err.message}`;
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        // Never log auth headers or cookies
        userAgent: req.headers['user-agent'],
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
  // Skip health check logs to avoid noise
  autoLogging: {
    ignore: (req) =>
      req.url?.startsWith('/health') ?? false,
  },
  quietReqLogger: env.NODE_ENV === 'test',
});
