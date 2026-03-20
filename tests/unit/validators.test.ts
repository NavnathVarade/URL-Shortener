// Mock env before importing validators
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.MAX_URL_LENGTH = '2048';
process.env.ALLOWED_SCHEMES = 'http,https';
process.env.BASE_URL = 'http://localhost:3000';

import { validate, shortenUrlSchema, shortCodeParamSchema } from '../../src/utils/validators';
import { ValidationError } from '../../src/utils/errors';


describe('Validators', () => {
  describe('shortenUrlSchema', () => {
    it('accepts a valid HTTP URL', () => {
      const result = validate(shortenUrlSchema, { url: 'http://example.com' });
      expect(result.url).toBe('http://example.com');
    });

    it('accepts a valid HTTPS URL', () => {
      const result = validate(shortenUrlSchema, { url: 'https://example.com/path?q=1' });
      expect(result.url).toBeTruthy();
    });

    it('accepts a URL with a custom code', () => {
      const result = validate(shortenUrlSchema, {
        url: 'https://example.com',
        customCode: 'mycode',
      });
      expect(result.customCode).toBe('mycode');
    });

    it('rejects a URL without a scheme', () => {
      expect(() => validate(shortenUrlSchema, { url: 'example.com' })).toThrow(ValidationError);
    });

    it('rejects an ftp:// URL', () => {
      expect(() => validate(shortenUrlSchema, { url: 'ftp://example.com' })).toThrow(ValidationError);
    });

    it('rejects an empty URL', () => {
      expect(() => validate(shortenUrlSchema, { url: '' })).toThrow(ValidationError);
    });

    it('rejects a URL exceeding max length', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2049);
      expect(() => validate(shortenUrlSchema, { url: longUrl })).toThrow(ValidationError);
    });

    it('rejects a custom code with special characters', () => {
      expect(() =>
        validate(shortenUrlSchema, { url: 'https://example.com', customCode: 'my code!' }),
      ).toThrow(ValidationError);
    });

    it('rejects a custom code shorter than 3 chars', () => {
      expect(() =>
        validate(shortenUrlSchema, { url: 'https://example.com', customCode: 'ab' }),
      ).toThrow(ValidationError);
    });

    it('rejects a past expiresAt date', () => {
      expect(() =>
        validate(shortenUrlSchema, {
          url: 'https://example.com',
          expiresAt: '2020-01-01T00:00:00Z',
        }),
      ).toThrow(ValidationError);
    });

    it('accepts a future expiresAt date', () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const result = validate(shortenUrlSchema, {
        url: 'https://example.com',
        expiresAt: future,
      });
      expect(result.expiresAt).toBe(future);
    });
  });

  describe('shortCodeParamSchema', () => {
    it('accepts a valid alphanumeric code', () => {
      const result = validate(shortCodeParamSchema, { shortCode: 'abc123' });
      expect(result.shortCode).toBe('abc123');
    });

    it('accepts codes with hyphens and underscores', () => {
      const result = validate(shortCodeParamSchema, { shortCode: 'my-code_v2' });
      expect(result.shortCode).toBe('my-code_v2');
    });

    it('rejects codes shorter than 3 chars', () => {
      expect(() => validate(shortCodeParamSchema, { shortCode: 'ab' })).toThrow(ValidationError);
    });

    it('rejects codes with special characters', () => {
      expect(() => validate(shortCodeParamSchema, { shortCode: 'abc@!' })).toThrow(ValidationError);
    });
  });
});
