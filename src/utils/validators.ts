import { z } from 'zod';
import { env } from '../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas (Zod)
// ─────────────────────────────────────────────────────────────────────────────
// Zod chosen over Joi: TypeScript-first, zero dependencies, better DX.
// ─────────────────────────────────────────────────────────────────────────────

const allowedSchemes = env.ALLOWED_SCHEMES.split(',').map((s) => s.trim());

export const shortenUrlSchema = z.object({
  url: z
    .string({ required_error: 'URL is required' })
    .min(1, 'URL cannot be empty')
    .max(env.MAX_URL_LENGTH, `URL must be at most ${env.MAX_URL_LENGTH} characters`)
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return allowedSchemes.includes(parsed.protocol.replace(':', ''));
        } catch {
          return false;
        }
      },
      {
        message: `URL must be valid and use one of: ${allowedSchemes.join(', ')}`,
      },
    )
    .refine(
      (url) => {
        // Block localhost / private IPs in production (SSRF protection)
        if (env.NODE_ENV !== 'production') return true;
        try {
          const { hostname } = new URL(url);
          const privatePatterns = [
            /^localhost$/i,
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[01])\./,
            /^192\.168\./,
            /^::1$/,
            /^0\.0\.0\.0$/,
          ];
          return !privatePatterns.some((p) => p.test(hostname));
        } catch {
          return false;
        }
      },
      { message: 'URL points to a private or restricted address' },
    ),

  customCode: z
    .string()
    .min(3, 'Custom code must be at least 3 characters')
    .max(16, 'Custom code must be at most 16 characters')
    .regex(/^[0-9A-Za-z-_]+$/, 'Custom code must contain only alphanumeric, hyphen, or underscore')
    .optional(),

  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be a valid ISO 8601 datetime' })
    .refine((d) => new Date(d) > new Date(), { message: 'expiresAt must be in the future' })
    .optional(),

  userId: z.string().max(255).optional(),
});

export const shortCodeParamSchema = z.object({
  shortCode: z
    .string()
    .min(3, 'Short code too short')
    .max(16, 'Short code too long')
    .regex(/^[0-9A-Za-z-_]+$/, 'Invalid short code format'),
});

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic Validation Helper
// ─────────────────────────────────────────────────────────────────────────────

import { ValidationError } from './errors';

export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    throw new ValidationError('Validation failed', details);
  }
  return result.data;
}
