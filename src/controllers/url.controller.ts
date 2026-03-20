import { Request, Response, NextFunction } from 'express';
import { UrlService } from '../services/url.service';

// ─────────────────────────────────────────────────────────────────────────────
// URL Controller
// ─────────────────────────────────────────────────────────────────────────────
// Thin HTTP adapter layer. No business logic here — delegates to UrlService.
// ─────────────────────────────────────────────────────────────────────────────

export class UrlController {
  constructor(private readonly urlService: UrlService) {}

  /**
   * POST /shorten
   * Creates a new short URL.
   */
  shorten = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.urlService.shortenUrl(req.body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /:shortCode
   * Redirects to the original URL.
   * Uses 301 (permanent) for SEO benefit; 302 for analytics accuracy.
   * We use 302 so browsers don't cache the redirect (allows click tracking).
   */
  redirect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { shortCode } = req.params;

      const originalUrl = await this.urlService.resolveUrl(shortCode, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        referer: req.get('referer'),
        forwardedFor: req.get('x-forwarded-for'),
        remoteAddress: req.socket?.remoteAddress,
      });

      // Cache-Control: no-store ensures browser doesn't cache the 302
      // so each visit is tracked. For SEO-only use cases, use 301.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Short-Code', shortCode);
      res.redirect(302, originalUrl);
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /stats/:shortCode
   * Returns analytics for a given short URL.
   */
  getStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { shortCode } = req.params;
      const stats = await this.urlService.getStats(shortCode);
      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * DELETE /:shortCode
   * Deactivates a short URL (soft delete).
   */
  deactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { shortCode } = req.params;
      await this.urlService.deactivateUrl(shortCode);
      res.status(200).json({
        success: true,
        message: `Short URL '${shortCode}' has been deactivated`,
      });
    } catch (err) {
      next(err);
    }
  };
}
