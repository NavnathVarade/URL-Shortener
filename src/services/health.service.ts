import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { HealthCheckResponse, ServiceHealth } from '../types';
import { logger } from '../config/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Service
// ─────────────────────────────────────────────────────────────────────────────
// Used by:
//   - Load balancer health checks (ALB target group)
//   - Kubernetes liveness/readiness probes
//   - Monitoring (Datadog, CloudWatch)
// ─────────────────────────────────────────────────────────────────────────────

export class HealthService {
  private readonly startTime = Date.now();

  constructor(
    private readonly db: PrismaClient,
    private readonly redis: Redis,
    private readonly queue: Queue,
  ) {}

  async check(): Promise<HealthCheckResponse> {
    const [dbHealth, cacheHealth, queueHealth] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueue(),
    ]);

    const services = {
      database: dbHealth.status === 'fulfilled' ? dbHealth.value : 'unhealthy' as ServiceHealth,
      cache: cacheHealth.status === 'fulfilled' ? cacheHealth.value : 'unhealthy' as ServiceHealth,
      queue: queueHealth.status === 'fulfilled' ? queueHealth.value : 'unhealthy' as ServiceHealth,
    };

    const overallStatus = this.determineOverallStatus(services);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      services,
    };
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return 'healthy';
    } catch (err) {
      logger.error({ err }, 'Database health check failed');
      return 'unhealthy';
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG' ? 'healthy' : 'degraded';
    } catch (err) {
      logger.error({ err }, 'Redis health check failed');
      return 'unhealthy';
    }
  }

  private async checkQueue(): Promise<ServiceHealth> {
    try {
      const counts = await this.queue.getJobCounts('failed');
      // If failed count is very high, mark as degraded
      return (counts.failed ?? 0) > 1000 ? 'degraded' : 'healthy';
    } catch (err) {
      logger.error({ err }, 'Queue health check failed');
      return 'unhealthy';
    }
  }

  private determineOverallStatus(services: HealthCheckResponse['services']): ServiceHealth {
    const statuses = Object.values(services);
    if (statuses.some((s) => s === 'unhealthy')) return 'unhealthy';
    if (statuses.some((s) => s === 'degraded')) return 'degraded';
    return 'healthy';
  }
}
