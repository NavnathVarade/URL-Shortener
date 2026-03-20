import { Request, Response, NextFunction } from 'express';
import { HealthService } from '../services/health.service';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  check = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const health = await this.healthService.check();
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (err) {
      next(err);
    }
  };

  /**
   * Liveness probe — returns 200 if the process is alive.
   * Does NOT check dependencies (DB, Redis). Used by Kubernetes liveness probe.
   */
  liveness = (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
  };

  /**
   * Readiness probe — returns 200 only if all dependencies are healthy.
   * Used by Kubernetes readiness probe to gate traffic routing.
   */
  readiness = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const health = await this.healthService.check();
      if (health.status === 'unhealthy') {
        res.status(503).json({ status: 'not ready', services: health.services });
        return;
      }
      res.status(200).json({ status: 'ready', services: health.services });
    } catch (err) {
      next(err);
    }
  };
}
