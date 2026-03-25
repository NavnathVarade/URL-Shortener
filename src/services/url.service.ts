import { Queue } from 'bullmq';
import { UrlRepository } from '../repositories/url.repository';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { AnalyticsJobPayload, ShortenUrlResponse, UrlStatsResponse } from '../types';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { cacheKeys, getCache, setCache, deleteCache } from '../config/redis';
import { encodeBase62, normalizeUrl, detectDevice, extractIp, serializeBigInt } from '../utils/base62';
import { validate, shortenUrlSchema, shortCodeParamSchema } from '../utils/validators';
import { GoneError, NotFoundError } from '../utils/errors';
import { enqueueAnalyticsEvent } from '../workers/analytics.queue';

// ─────────────────────────────────────────────────────────────────────────────
// Counter-based ID Generator (for Base62 encoding)
// ─────────────────────────────────────────────────────────────────────────────
// Uses a PostgreSQL sequence via raw query for distributed-safe ID generation.
// Each API server instance fetches IDs from the centralized sequence.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// URL Service
// ─────────────────────────────────────────────────────────────────────────────

export class UrlService {
  private readonly baseUrl: string;
  private readonly cacheTtl: number;

  constructor(
    private readonly urlRepo: UrlRepository,
    private readonly analyticsRepo: AnalyticsRepository,
    private readonly analyticsQueue: Queue<AnalyticsJobPayload>,
  ) {
    this.baseUrl = env.BASE_URL;
    this.cacheTtl = env.CACHE_TTL_SECONDS;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Shorten URL
  // ───────────────────────────────────────────────────────────────────────────

  async shortenUrl(input: unknown): Promise<ShortenUrlResponse> {
    const { url, customCode, expiresAt, userId } = validate(shortenUrlSchema, input);

    const normalizedUrl = normalizeUrl(url);
    const shortCode = customCode ?? (await this.generateShortCode());
    const expiry = expiresAt ? new Date(expiresAt) : undefined;

    const record = await this.urlRepo.create({
      shortCode,
      originalUrl: normalizedUrl,
      userId,
      expiresAt: expiry,
    });

    // Warm the cache immediately after creation
    await setCache(cacheKeys.url(shortCode), normalizedUrl, this.cacheTtl);

    logger.info({ shortCode, originalUrl: normalizedUrl }, 'URL shortened');

    return {
      shortUrl: `${this.baseUrl}/${record.shortCode}`,
      shortCode: record.shortCode,
      originalUrl: record.originalUrl,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Resolve Short Code → Original URL (redirect path)
  // ───────────────────────────────────────────────────────────────────────────

  async resolveUrl(
    shortCode: string,
    requestContext: {
      ip?: string;
      userAgent?: string;
      referer?: string;
      forwardedFor?: string;
      remoteAddress?: string;
    },
  ): Promise<string> {
    validate(shortCodeParamSchema, { shortCode });

    // 1. Cache lookup (L1) — ~0.1ms
    const cached = await getCache(cacheKeys.url(shortCode));
    if (cached) {
      logger.debug({ shortCode, source: 'cache' }, 'Cache hit');
      void this.trackClick(shortCode, requestContext); // fire-and-forget
      return cached;
    }

    // 2. Database lookup (L2)
    const record = await this.urlRepo.findActiveByShortCode(shortCode);

    if (!record) {
      // Check if it exists but is expired or deactivated
      const exists = await this.urlRepo.findByShortCode(shortCode);
      if (exists) {
        if (exists.expiresAt && exists.expiresAt < new Date()) {
          throw new GoneError('Short URL');
        }
        throw new GoneError('Short URL'); // deactivated
      }
      throw new NotFoundError('Short URL', shortCode);
    }

    // Warm cache for future requests
    await setCache(cacheKeys.url(shortCode), record.originalUrl, this.cacheTtl);

    void this.trackClick(shortCode, requestContext); // fire-and-forget

    return record.originalUrl;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Get URL Statistics
  // ───────────────────────────────────────────────────────────────────────────

  async getStats(shortCode: string): Promise<UrlStatsResponse> {
    validate(shortCodeParamSchema, { shortCode });

    const record = await this.urlRepo.findByShortCode(shortCode);
    if (!record) throw new NotFoundError('Short URL', shortCode);

    const { recentClicks } = await this.analyticsRepo.getStats(shortCode, 20);

    return {
      shortCode: record.shortCode,
      originalUrl: record.originalUrl,
      clickCount: serializeBigInt(record.clickCount),
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt?.toISOString() ?? null,
      recentClicks: recentClicks.map((c) => ({
        clickedAt: c.clickedAt.toISOString(),
        country: c.country,
        device: c.device,
      })),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Deactivate a URL
  // ───────────────────────────────────────────────────────────────────────────

  async deactivateUrl(shortCode: string): Promise<void> {
    validate(shortCodeParamSchema, { shortCode });
    await this.urlRepo.deactivate(shortCode);
    await deleteCache(cacheKeys.url(shortCode));
    logger.info({ shortCode }, 'URL deactivated');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Generates a unique short code using PostgreSQL sequence + Base62.
   * Falls back to UUID-based approach if sequence is unavailable.
   */
  private async generateShortCode(): Promise<string> {
    // Get next sequence value from PostgreSQL (atomic, distributed-safe)
    const rows = await this.urlRepo['db'].$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('url_seq') AS nextval
    `;
    const seqVal = rows[0]?.nextval ?? BigInt(Date.now());
    const offset = env.SHORT_CODE_OFFSET; // already bigint
    const code = encodeBase62(seqVal + offset);
    // Pad to fixed length for consistent URLs
    return code.padStart(env.SHORT_CODE_LENGTH, '0');
  }

  /**
   * Enqueues a click event for async processing.
   * Never throws — analytics loss is acceptable; redirect must not fail.
   */
  private async trackClick(
    shortCode: string,
    ctx: {
      ip?: string;
      userAgent?: string;
      referer?: string;
      forwardedFor?: string;
      remoteAddress?: string;
    },
  ): Promise<void> {
    try {
      const ip = extractIp(ctx.forwardedFor, ctx.remoteAddress ?? ctx.ip);
      const device = detectDevice(ctx.userAgent);

      const payload: AnalyticsJobPayload = {
        shortCode,
        ipAddress: ip,
        userAgent: ctx.userAgent,
        referer: ctx.referer,
        device,
        clickedAt: new Date().toISOString(),
      };

      await enqueueAnalyticsEvent(this.analyticsQueue, payload);
    } catch (err) {
      logger.warn({ err, shortCode }, 'trackClick enqueue failed (non-fatal)');
    }
  }
}
