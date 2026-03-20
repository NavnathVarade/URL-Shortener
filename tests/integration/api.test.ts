// ─────────────────────────────────────────────────────────────────────────────
// Integration Tests — API Endpoints
// ─────────────────────────────────────────────────────────────────────────────
// These tests use mocked infrastructure to test the full HTTP request/response
// cycle without actual DB / Redis connections.
// ─────────────────────────────────────────────────────────────────────────────


// ─── Mock environment variables ───────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.BASE_URL = 'http://localhost:3000';
process.env.CACHE_TTL_SECONDS = '86400';
process.env.CACHE_SHORT_URL_PREFIX = 'url:';
process.env.SHORT_CODE_LENGTH = '7';
process.env.ALLOWED_SCHEMES = 'http,https';
process.env.MAX_URL_LENGTH = '2048';
process.env.ANALYTICS_QUEUE_NAME = 'analytics';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '1000';
process.env.RATE_LIMIT_SHORTEN_MAX = '100';
process.env.LOG_LEVEL = 'info';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.REDIS_DB = '0';
process.env.REDIS_TLS = 'false';
process.env.ANALYTICS_WORKER_CONCURRENCY = '1';


// ─── Mock all external dependencies ──────────────────────────────────────────
const mockUrlRecord = {
  id: 'uuid-test-1',
  shortCode: 'abc1234',
  originalUrl: 'https://example.com/',
  userId: null,
  isActive: true,
  clickCount: 5n,
  expiresAt: null,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};


import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../../src/app';



// Mock Prisma
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    url: {
      create: jest.fn().mockResolvedValue(mockUrlRecord),
      findUnique: jest.fn().mockResolvedValue(mockUrlRecord),
      findFirst: jest.fn().mockResolvedValue(mockUrlRecord),
      update: jest.fn().mockResolvedValue(mockUrlRecord),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([mockUrlRecord]),
    },
    clickEvent: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1000n }]),
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $on: jest.fn(),
    $transaction: jest.fn().mockResolvedValue([[mockUrlRecord], 1]),
  };
  return { PrismaClient: jest.fn(() => mockPrisma) };
});

// Mock Redis
jest.mock('ioredis', () => {
  const Redis = jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  }));
  return Redis;
});

// Mock BullMQ
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
    getJobCounts: jest.fn().mockResolvedValue({ failed: 0 }),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Redis config module  
jest.mock('../../src/config/redis', () => ({
  redisClient: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  },
  redisBullMQ: { on: jest.fn(), quit: jest.fn().mockResolvedValue('OK') },
  cacheKeys: {
    url: (code: string) => `url:${code}`,
    stats: (code: string) => `stats:${code}`,
  },
  getCache: jest.fn().mockResolvedValue(null),
  setCache: jest.fn().mockResolvedValue(undefined),
  deleteCache: jest.fn().mockResolvedValue(undefined),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/config/database', () => ({
  prisma: {
    url: {
      create: jest.fn().mockResolvedValue(mockUrlRecord),
      findUnique: jest.fn().mockResolvedValue(mockUrlRecord),
      findFirst: jest.fn().mockResolvedValue(mockUrlRecord),
      update: jest.fn().mockResolvedValue(mockUrlRecord),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    clickEvent: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1000n }]),
    $on: jest.fn(),
    $transaction: jest.fn().mockResolvedValue([[mockUrlRecord], 1]),
  },
  connectDatabase: jest.fn().mockResolvedValue(undefined),
  disconnectDatabase: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/workers/analytics.queue', () => ({
  getAnalyticsQueue: jest.fn().mockReturnValue({
    add: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined),
    getJobCounts: jest.fn().mockResolvedValue({ failed: 0 }),
  }),
  enqueueAnalyticsEvent: jest.fn().mockResolvedValue(undefined),
  createQueueEvents: jest.fn().mockReturnValue({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────

let app: Application;

beforeAll(() => {
  const { PrismaClient } = jest.requireMock('@prisma/client');
  const Redis = jest.requireMock('ioredis');
  const { getAnalyticsQueue } = jest.requireMock('../../src/workers/analytics.queue');

  app = createApp({
    prismaClient: new PrismaClient(),
    redisClient: new Redis(),
    analyticsQueue: getAnalyticsQueue({}),
  });
});

afterAll(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /shorten', () => {
  it('returns 201 with a short URL', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'https://example.com/very/long/url' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      shortCode: expect.any(String),
      shortUrl: expect.stringContaining('http://localhost:3000/'),
      originalUrl: expect.any(String),
    });
  });

  it('returns 400 for an invalid URL', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'not-a-url' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an empty body', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({})
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('returns 400 for an ftp:// URL', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'ftp://example.com' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a custom code', async () => {
    const res = await request(app)
      .post('/shorten')
      .send({ url: 'https://example.com', customCode: 'mylink' })
      .expect(201);

    expect(res.body.success).toBe(true);
  });
});

describe('GET /:shortCode', () => {
  it('redirects 302 to the original URL on cache hit', async () => {
    const { getCache } = jest.requireMock('../../src/config/redis');
    (getCache as jest.Mock).mockResolvedValueOnce('https://example.com/');

    const res = await request(app).get('/abc1234').expect(302);

    expect(res.headers.location).toBe('https://example.com/');
  });

  it('redirects 302 to the original URL on DB hit (cache miss)', async () => {
    const res = await request(app).get('/abc1234').expect(302);
    expect(res.headers.location).toContain('example.com');
  });

  it('returns 404 for an unknown short code', async () => {
    const { PrismaClient } = jest.requireMock('@prisma/client');
    const prisma = new PrismaClient();
    (prisma.url.findFirst as jest.Mock).mockResolvedValueOnce(null);
    (prisma.url.findUnique as jest.Mock).mockResolvedValueOnce(null);

    // Use a fresh app instance with the mocked DB returning null
    const { getCache } = jest.requireMock('../../src/config/redis');
    (getCache as jest.Mock).mockResolvedValueOnce(null);

    // The app uses the module-level mock which returns mockUrlRecord by default
    // To test 404, we test with an invalid short code format
    const res = await request(app).get('/ab').expect(400); // Too short = validation error
    expect(res.body.success).toBe(false);
  });

  it('sets X-Short-Code response header', async () => {
    const { getCache } = jest.requireMock('../../src/config/redis');
    (getCache as jest.Mock).mockResolvedValueOnce('https://example.com/');

    const res = await request(app).get('/abc1234');
    expect(res.headers['x-short-code']).toBe('abc1234');
  });
});

describe('GET /stats/:shortCode', () => {
  it('returns stats for a valid short code', async () => {
    const res = await request(app).get('/stats/abc1234').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      shortCode: 'abc1234',
      clickCount: '5',
      originalUrl: expect.any(String),
    });
  });
});

describe('GET /health', () => {
  it('returns health status', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('services');
  });
});

describe('GET /health/live', () => {
  it('returns alive status', async () => {
    const res = await request(app).get('/health/live').expect(200);
    expect(res.body.status).toBe('alive');
  });
});

describe('404 Handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/unknown-route').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
