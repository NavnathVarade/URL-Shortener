import { Prisma, PrismaClient } from '@prisma/client';
import { UrlRecord } from '../types';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// URL Repository
// ─────────────────────────────────────────────────────────────────────────────
// Repository pattern: encapsulates all DB queries for the urls table.
// Keeps services free of ORM-specific code → easy to swap Prisma for raw SQL.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUrlInput {
  shortCode: string;
  originalUrl: string;
  userId?: string;
  expiresAt?: Date;
}

export class UrlRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Creates a new URL mapping.
   * Throws ConflictError if shortCode already exists.
   */
  async create(input: CreateUrlInput): Promise<UrlRecord> {
    try {
      const record = await this.db.url.create({
        data: {
          shortCode: input.shortCode,
          originalUrl: input.originalUrl,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
      });
      return record as UrlRecord;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' // Unique constraint violation
      ) {
        throw new ConflictError(`Short code '${input.shortCode}' is already taken`);
      }
      logger.error({ err, input }, 'UrlRepository.create failed');
      throw err;
    }
  }

  /**
   * Finds a URL by its short code.
   * Returns null if not found (caller decides how to handle it).
   */
  async findByShortCode(shortCode: string): Promise<UrlRecord | null> {
    const record = await this.db.url.findUnique({
      where: { shortCode },
    });
    return record as UrlRecord | null;
  }

  /**
   * Finds an active, non-expired URL by short code.
   * Returns null if inactive or expired.
   */
  async findActiveByShortCode(shortCode: string): Promise<UrlRecord | null> {
    const record = await this.db.url.findFirst({
      where: {
        shortCode,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return record as UrlRecord | null;
  }

  /**
   * Atomically increments click count.
   * Uses UPDATE WHERE for a single DB round-trip (no SELECT + UPDATE).
   */
  async incrementClickCount(shortCode: string): Promise<void> {
    await this.db.url.update({
      where: { shortCode },
      data: { clickCount: { increment: 1 } },
    });
  }

  /**
   * Soft-deletes a URL (sets isActive = false).
   */
  async deactivate(shortCode: string): Promise<void> {
    const result = await this.db.url.updateMany({
      where: { shortCode, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundError('URL', shortCode);
    }
  }

  /**
   * Lists URLs for a given user (paginated).
   */
  async findByUserId(
    userId: string,
    skip: number,
    take: number,
  ): Promise<{ records: UrlRecord[]; total: number }> {
    const [records, total] = await this.db.$transaction([
      this.db.url.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.db.url.count({ where: { userId, isActive: true } }),
    ]);
    return { records: records as UrlRecord[], total };
  }

  /**
   * Returns the maximum ID used for counter-based Base62 generation.
   * This is used once at startup to seed the in-memory counter.
   */
  async getLastSequenceValue(): Promise<bigint> {
    const result = await this.db.$queryRaw<[{ nextval: bigint }]>`
      SELECT nextval('url_id_seq') as nextval
    `;
    return result[0]?.nextval ?? 1n;
  }

  /**
   * Checks if a custom short code is available.
   */
  async isShortCodeAvailable(shortCode: string): Promise<boolean> {
    const existing = await this.db.url.findUnique({
      where: { shortCode },
      select: { id: true },
    });
    return existing === null;
  }
}
