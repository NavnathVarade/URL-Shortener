import pino from 'pino';
import { env } from './env';

// ─────────────────────────────────────────────────────────────────────────────
// Logger (Pino)
// ─────────────────────────────────────────────────────────────────────────────
// Pino is the fastest Node.js logger — up to 6x faster than Winston.
// In production: structured JSON logs shipped to centralized logging (DataDog,
// CloudWatch Logs, ELK). In development: pretty-printed for readability.
// ─────────────────────────────────────────────────────────────────────────────

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.LOG_PRETTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // Production: structured JSON with standard fields
        formatters: {
          level(label: string) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
  base: {
    service: env.APP_NAME,
    env: env.NODE_ENV,
  },
  redact: {
    // Never log sensitive fields
    paths: ['req.headers.authorization', 'req.headers.cookie', 'ipAddress'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;
