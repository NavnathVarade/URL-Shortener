import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Environment Variable Schema
// ─────────────────────────────────────────────────────────────────────────────
// Fail-fast at startup: if any required env var is missing or malformed,
// the process exits immediately with a descriptive error.
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  APP_NAME: z.string().min(1).default('url-shortener'),
  BASE_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_TLS: z  
  .string()
  .transform((val) => val === 'true')
  .default('false'),                                                                                 // v2

  // Cache
  CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  CACHE_SHORT_URL_PREFIX: z.string().default('url:'),

  // URL Shortener
  SHORT_CODE_LENGTH: z.coerce.number().min(5).max(16).default(7),
  MAX_URL_LENGTH: z.coerce.number().default(2048),
  ALLOWED_SCHEMES: z.string().default('http,https'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RATE_LIMIT_SHORTEN_MAX: z.coerce.number().default(10),

  // BullMQ / Analytics
  ANALYTICS_QUEUE_NAME: z.string().default('analytics'),
  ANALYTICS_WORKER_CONCURRENCY: z.coerce.number().default(5),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    console.error(`\n❌ Invalid environment variables:\n${formatted}\n`);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
