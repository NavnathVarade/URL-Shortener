import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isAppError, ValidationError } from '../utils/errors';
import { logger } from '../config/logger';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler Middleware
// ─────────────────────────────────────────────────────────────────────────────
// Catches all errors propagated via next(err).
// Distinguishes operational errors (safe to surface) from bugs (log + 500).
// ─────────────────────────────────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // ─── Operational errors (AppError subclasses) ────────────────────────────
  if (isAppError(err)) {
    logger.warn(
      {
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
        path: req.path,
        method: req.method,
      },
      'Operational error',
    );

    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err instanceof ValidationError && err.details
          ? { details: err.details }
          : {}),
      },
    });
    return;
  }

  // ─── Zod validation errors (should be caught by validate() but just in case)
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.errors,
      },
    });
    return;
  }

  // ─── Prisma known errors ──────────────────────────────────────────────────
  if (isPrismaError(err)) {
    handlePrismaError(err, res);
    return;
  }

  // ─── Unknown / programmer errors ─────────────────────────────────────────
  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
      body: req.body,
    },
    'Unhandled error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'An unexpected error occurred' : String(err),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 404 Handler (no route matched)
// ─────────────────────────────────────────────────────────────────────────────

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PrismaError {
  code: string;
  meta?: { target?: string[] };
}

function isPrismaError(err: unknown): err is PrismaError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as PrismaError).code === 'string' &&
    (err as PrismaError).code.startsWith('P')
  );
}

function handlePrismaError(err: PrismaError, res: Response): void {
  switch (err.code) {
    case 'P2002':
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this value already exists',
          field: err.meta?.target,
        },
      });
      break;
    case 'P2025':
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      });
      break;
    default:
      res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Database operation failed' },
      });
  }
}
