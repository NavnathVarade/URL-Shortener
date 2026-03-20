import { Router } from 'express';
import { UrlController } from '../controllers/url.controller';
import { HealthController } from '../controllers/health.controller';

// ─────────────────────────────────────────────────────────────────────────────
// URL Routes
// ─────────────────────────────────────────────────────────────────────────────

export function createUrlRouter(controller: UrlController): Router {
  const router = Router();

  /**
   * POST /shorten
   * Body: { url: string, customCode?: string, expiresAt?: string }
   */
  router.post('/shorten', controller.shorten);

  /**
   * GET /stats/:shortCode
   * Returns analytics for a short URL.
   * NOTE: Must be registered BEFORE /:shortCode to avoid routing conflicts.
   */
  router.get('/stats/:shortCode', controller.getStats);

  /**
   * GET /:shortCode
   * Redirects to the original URL.
   */
  router.get('/:shortCode', controller.redirect);

  /**
   * DELETE /:shortCode
   * Deactivates a short URL.
   */
  router.delete('/:shortCode', controller.deactivate);

  return router;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Routes
// ─────────────────────────────────────────────────────────────────────────────

export function createHealthRouter(controller: HealthController): Router {
  const router = Router();

  router.get('/health', controller.check);
  router.get('/health/live', controller.liveness);
  router.get('/health/ready', controller.readiness);

  return router;
}
