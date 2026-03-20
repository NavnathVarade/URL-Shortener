import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

// ─────────────────────────────────────────────────────────────────────────────
// Redis Client
// ─────────────────────────────────────────────────────────────────────────────
// ioredis provides built-in retry logic, cluster support, and Lua scripting.
// Two clients:
//   - redisClient: general-purpose cache
//   - redisSubscriber: BullMQ internal subscriber (separate connection required)
// ─────────────────────────────────────────────────────────────────────────────

const createRedisClient = (name: string): Redis => {
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    tls: env.REDIS_TLS === true ? {} : undefined,                                                                               // v2
    // Retry strategy: exponential backoff with jitter, max 30s
    retryStrategy(times: number) {
      const delay = Math.min(Math.random() * 100 + Math.pow(2, times) * 50, 30000);
      logger.warn({ attempt: times, delayMs: delay }, `[Redis:${name}] Reconnecting...`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    keepAlive: 10000,
    connectTimeout: 10000,
    commandTimeout: 5000,
  });

  client.on('connect', () => logger.info(`✅ Redis [${name}] connected`));
  client.on('ready', () => logger.info(`Redis [${name}] ready`));
  client.on('error', (err: Error) => logger.error({ err }, `Redis [${name}] error`));
  client.on('close', () => logger.warn(`Redis [${name}] connection closed`));
  client.on('reconnecting', () => logger.warn(`Redis [${name}] reconnecting`));

  return client;
};

export const redisClient = createRedisClient('cache');
export const redisBullMQ = createRedisClient('bullmq');

// ─────────────────────────────────────────────────────────────────────────────
// Cache Helpers
// ─────────────────────────────────────────────────────────────────────────────

export const cacheKeys = {
  url: (shortCode: string) => `${env.CACHE_SHORT_URL_PREFIX}${shortCode}`,
  stats: (shortCode: string) => `stats:${shortCode}`,
  rateLimit: (ip: string) => `rl:${ip}`,
} as const;

export async function getCache(key: string): Promise<string | null> {
  try {
    return await redisClient.get(key);
  } catch (err) {
    logger.error({ err, key }, 'Cache GET failed');
    return null; // Graceful degradation: fall through to DB
  }
}

export async function setCache(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    if (ttlSeconds) {
      await redisClient.setex(key, ttlSeconds, value);
    } else {
      await redisClient.set(key, value);
    }
  } catch (err) {
    logger.error({ err, key }, 'Cache SET failed');
    // Non-fatal: continue without caching
  }
}

export async function deleteCache(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (err) {
    logger.error({ err, key }, 'Cache DEL failed');
  }
}

export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  await redisBullMQ.quit();
  logger.info('Redis clients disconnected');
}
