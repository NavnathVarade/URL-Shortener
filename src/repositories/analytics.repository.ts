import { PrismaClient } from '@prisma/client';
import { ClickEventRecord } from '../types';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Repository
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateClickEventInput {
  shortCode: string;
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  country?: string;
  device?: string;
  clickedAt?: Date;
}

export interface ClickStats {
  totalClicks: bigint;
  recentClicks: ClickEventRecord[];
  clicksByDay: { date: string; count: bigint }[];
}

export class AnalyticsRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Records a click event.
   * Called by the async analytics worker — not in the hot redirect path.
   */
  async createClickEvent(input: CreateClickEventInput): Promise<ClickEventRecord> {
    const record = await this.db.clickEvent.create({
      data: {
        shortCode: input.shortCode,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        referer: input.referer,
        country: input.country,
        device: input.device,
        clickedAt: input.clickedAt ?? new Date(),
      },
    });
    return record as ClickEventRecord;
  }

  /**
   * Retrieves aggregated stats for a short code.
   */
  async getStats(
    shortCode: string,
    limit = 10,
  ): Promise<{ recentClicks: ClickEventRecord[] }> {
    const recentClicks = await this.db.clickEvent.findMany({
      where: { shortCode },
      orderBy: { clickedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        shortCode: true,
        ipAddress: true,
        userAgent: true,
        referer: true,
        country: true,
        device: true,
        clickedAt: true,
      },
    });
    return { recentClicks: recentClicks as ClickEventRecord[] };
  }

  /**
   * Aggregates click counts per day over a given date range.
   * Uses raw SQL for efficient GROUP BY on the partitioned table.
   */
  async getClicksByDay(
    shortCode: string,
    from: Date,
    to: Date,
  ): Promise<{ date: string; count: bigint }[]> {
    try {
      const rows = await this.db.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT
          DATE("clickedAt")::TEXT AS date,
          COUNT(*)::BIGINT        AS count
        FROM click_events
        WHERE "shortCode" = ${shortCode}
          AND "clickedAt" BETWEEN ${from} AND ${to}
        GROUP BY DATE("clickedAt")
        ORDER BY date DESC
        LIMIT 90
      `;
      return rows;
    } catch (err) {
      logger.error({ err, shortCode }, 'getClicksByDay failed');
      return [];
    }
  }

  /**
   * Batch inserts click events for high-throughput scenarios.
   * Used when draining a buffer in the analytics worker.
   */
  async bulkCreateClickEvents(events: CreateClickEventInput[]): Promise<number> {
    const result = await this.db.clickEvent.createMany({
      data: events.map((e) => ({
        shortCode: e.shortCode,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        referer: e.referer,
        country: e.country,
        device: e.device,
        clickedAt: e.clickedAt ?? new Date(),
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
