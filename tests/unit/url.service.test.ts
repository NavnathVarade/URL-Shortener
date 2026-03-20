// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.BASE_URL = 'http://localhost:3000';
process.env.CACHE_TTL_SECONDS = '86400';
process.env.CACHE_SHORT_URL_PREFIX = 'url:';
process.env.SHORT_CODE_LENGTH = '7';
process.env.ALLOWED_SCHEMES = 'http,https';
process.env.MAX_URL_LENGTH = '2048';
process.env.ANALYTICS_QUEUE_NAME = 'analytics';


import { UrlService } from '../../src/services/url.service';
import { UrlRepository } from '../../src/repositories/url.repository';
import { AnalyticsRepository } from '../../src/repositories/analytics.repository';
import { NotFoundError, GoneError, ValidationError } from '../../src/utils/errors';


// Mock DB
const makeUrlRecord = (overrides = {}) => ({
  id: 'uuid-1',
  shortCode: 'abc1234',
  originalUrl: 'https://example.com',
  userId: null,
  isActive: true,
  clickCount: 0n,
  expiresAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});


// Mock Redis config
jest.mock('../../src/config/redis', () => ({
  cacheKeys: {
    url: (code: string) => `url:${code}`,
    stats: (code: string) => `stats:${code}`,
  },
  getCache: jest.fn().mockResolvedValue(null),
  setCache: jest.fn().mockResolvedValue(undefined),
  deleteCache: jest.fn().mockResolvedValue(undefined),
}));

// Mock analytics queue
jest.mock('../../src/workers/analytics.queue', () => ({
  enqueueAnalyticsEvent: jest.fn().mockResolvedValue(undefined),
}));

const { getCache, setCache, deleteCache } = jest.requireMock('../../src/config/redis');

// ─────────────────────────────────────────────────────────────────────────────
// Test Factories
// ─────────────────────────────────────────────────────────────────────────────

const makeService = (repoOverrides = {}, analyticsOverrides = {}) => {
  const mockUrlRepo = {
    create: jest.fn(),
    findByShortCode: jest.fn(),
    findActiveByShortCode: jest.fn(),
    incrementClickCount: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn().mockResolvedValue(undefined),
    isShortCodeAvailable: jest.fn().mockResolvedValue(true),
    db: {
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: 1000n }]),
    },
    ...repoOverrides,
  } as unknown as UrlRepository;

  const mockAnalyticsRepo = {
    getStats: jest.fn().mockResolvedValue({ recentClicks: [] }),
    createClickEvent: jest.fn().mockResolvedValue({}),
    ...analyticsOverrides,
  } as unknown as AnalyticsRepository;

  const mockQueue = { add: jest.fn().mockResolvedValue({}) } as unknown as never;

  return { service: new UrlService(mockUrlRepo, mockAnalyticsRepo, mockQueue), mockUrlRepo, mockAnalyticsRepo };
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('UrlService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCache as jest.Mock).mockResolvedValue(null);
  });

  // ─── shortenUrl ────────────────────────────────────────────────────────────

  describe('shortenUrl', () => {
    it('creates a short URL and returns the response shape', async () => {
      const record = makeUrlRecord();
      const { service, mockUrlRepo } = makeService({
        create: jest.fn().mockResolvedValue(record),
      });

      const result = await service.shortenUrl({ url: 'https://example.com' });

      expect(mockUrlRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ originalUrl: 'https://example.com/' }),
      );
      expect(result).toMatchObject({
        shortCode: 'abc1234',
        originalUrl: 'https://example.com',
        shortUrl: expect.stringContaining('/abc1234'),
      });
    });

    it('uses custom code when provided', async () => {
      const record = makeUrlRecord({ shortCode: 'mycode' });
      const { service, mockUrlRepo } = makeService({
        create: jest.fn().mockResolvedValue(record),
      });

      const result = await service.shortenUrl({
        url: 'https://example.com',
        customCode: 'mycode',
      });

      expect(mockUrlRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ shortCode: 'mycode' }),
      );
      expect(result.shortCode).toBe('mycode');
    });

    it('warms the cache after creating a URL', async () => {
      const { service } = makeService({
        create: jest.fn().mockResolvedValue(makeUrlRecord()),
      });

      await service.shortenUrl({ url: 'https://example.com' });

      expect(setCache).toHaveBeenCalledWith(
        expect.stringContaining('url:'),
        expect.any(String),
        expect.any(Number),
      );
    });

    it('throws ValidationError for an invalid URL', async () => {
      const { service } = makeService();
      await expect(service.shortenUrl({ url: 'not-a-url' })).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an ftp:// URL', async () => {
      const { service } = makeService();
      await expect(service.shortenUrl({ url: 'ftp://example.com' })).rejects.toThrow(ValidationError);
    });
  });

  // ─── resolveUrl ───────────────────────────────────────────────────────────

  describe('resolveUrl', () => {
    const ctx = { ip: '1.2.3.4', userAgent: 'TestAgent' };

    it('returns original URL from cache (cache hit)', async () => {
      (getCache as jest.Mock).mockResolvedValueOnce('https://example.com');
      const { service } = makeService();

      const url = await service.resolveUrl('abc1234', ctx);
      expect(url).toBe('https://example.com');
    });

    it('returns original URL from DB (cache miss)', async () => {
      const record = makeUrlRecord({ originalUrl: 'https://db-result.com' });
      const { service } = makeService({
        findActiveByShortCode: jest.fn().mockResolvedValue(record),
      });

      const url = await service.resolveUrl('abc1234', ctx);
      expect(url).toBe('https://db-result.com');
    });

    it('warms cache after DB hit', async () => {
      const record = makeUrlRecord({ originalUrl: 'https://db-result.com' });
      const { service } = makeService({
        findActiveByShortCode: jest.fn().mockResolvedValue(record),
      });

      await service.resolveUrl('abc1234', ctx);
      expect(setCache).toHaveBeenCalled();
    });

    it('throws NotFoundError for unknown short code', async () => {
      const { service } = makeService({
        findActiveByShortCode: jest.fn().mockResolvedValue(null),
        findByShortCode: jest.fn().mockResolvedValue(null),
      });

      await expect(service.resolveUrl('unknown', ctx)).rejects.toThrow(NotFoundError);
    });

    it('throws GoneError for expired URL', async () => {
      const expired = makeUrlRecord({ expiresAt: new Date('2000-01-01') });
      const { service } = makeService({
        findActiveByShortCode: jest.fn().mockResolvedValue(null),
        findByShortCode: jest.fn().mockResolvedValue(expired),
      });

      await expect(service.resolveUrl('abc1234', ctx)).rejects.toThrow(GoneError);
    });
  });

  // ─── getStats ─────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns stats for an existing URL', async () => {
      const record = makeUrlRecord({ clickCount: 42n });
      const { service } = makeService({
        findByShortCode: jest.fn().mockResolvedValue(record),
      });

      const stats = await service.getStats('abc1234');

      expect(stats.shortCode).toBe('abc1234');
      expect(stats.clickCount).toBe('42');
    });

    it('throws NotFoundError for unknown short code', async () => {
      const { service } = makeService({
        findByShortCode: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getStats('unknown')).rejects.toThrow(NotFoundError);
    });
  });

  // ─── deactivateUrl ────────────────────────────────────────────────────────

  describe('deactivateUrl', () => {
    it('calls deactivate and clears cache', async () => {
      const { service, mockUrlRepo } = makeService();

      await service.deactivateUrl('abc1234');

      expect(mockUrlRepo.deactivate).toHaveBeenCalledWith('abc1234');
      expect(deleteCache).toHaveBeenCalledWith(expect.stringContaining('abc1234'));
    });
  });
});
