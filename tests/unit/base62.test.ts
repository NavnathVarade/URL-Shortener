import { encodeBase62, decodeBase62, padBase62, isValidBase62, normalizeUrl, detectDevice, extractIp, serializeBigInt } from '../../src/utils/base62';

describe('Base62 Encoding', () => {
  describe('encodeBase62', () => {
    it('encodes 0 to "0"', () => {
      expect(encodeBase62(0n)).toBe('0');
    });

    it('encodes 1 to "1"', () => {
      expect(encodeBase62(1n)).toBe('1');
    });

    it('encodes 62 to "10" (Base62 rollover)', () => {
      expect(encodeBase62(62n)).toBe('10');
    });

    it('encodes 3844 to "100" (62^2)', () => {
      expect(encodeBase62(3844n)).toBe('100');
    });

    it('encodes large numbers correctly', () => {
      const large = 1_000_000n;
      const encoded = encodeBase62(large);
      expect(encoded).toBeTruthy();
      expect(typeof encoded).toBe('string');
    });

    it('accepts number inputs as well as bigint', () => {
      expect(encodeBase62(62)).toBe('10');
    });

    it('produces only Base62 characters', () => {
      for (let i = 0; i < 1000; i++) {
        const encoded = encodeBase62(BigInt(i));
        expect(encoded).toMatch(/^[0-9A-Za-z]+$/);
      }
    });
  });

  describe('decodeBase62', () => {
    it('decodes "0" to 0n', () => {
      expect(decodeBase62('0')).toBe(0n);
    });

    it('decodes "10" to 62n', () => {
      expect(decodeBase62('10')).toBe(62n);
    });

    it('is the inverse of encodeBase62', () => {
      const nums = [0n, 1n, 61n, 62n, 3844n, 1_000_000n, 999_999_999n];
      for (const n of nums) {
        expect(decodeBase62(encodeBase62(n))).toBe(n);
      }
    });

    it('throws on invalid characters', () => {
      expect(() => decodeBase62('abc!')).toThrow('Invalid Base62 character');
    });
  });

  describe('padBase62', () => {
    it('pads short codes to desired length', () => {
      expect(padBase62('1', 7)).toBe('0000001');
    });

    it('does not truncate longer codes', () => {
      expect(padBase62('12345678', 7)).toBe('12345678');
    });
  });

  describe('isValidBase62', () => {
    it('accepts alphanumeric codes', () => {
      expect(isValidBase62('abc123XYZ')).toBe(true);
    });

    it('rejects codes with special characters', () => {
      expect(isValidBase62('abc-123')).toBe(false);
      expect(isValidBase62('abc!@#')).toBe(false);
    });
  });
});

describe('URL Utilities', () => {
  describe('normalizeUrl', () => {
    it('lowercases the scheme and host', () => {
      expect(normalizeUrl('HTTP://EXAMPLE.COM/path')).toContain('http://example.com');
    });

    it('preserves the path', () => {
      const url = 'https://example.com/some/PATH?q=1';
      expect(normalizeUrl(url)).toContain('/some/PATH');
    });

    it('returns the input unchanged if it is not a valid URL', () => {
      const invalid = 'not-a-url';
      expect(normalizeUrl(invalid)).toBe(invalid);
    });
  });

  describe('detectDevice', () => {
    it('detects mobile', () => {
      expect(detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS)')).toBe('mobile');
    });

    it('detects desktop', () => {
      expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/91')).toBe('desktop');
    });

    it('detects bots', () => {
      expect(detectDevice('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('bot');
    });

    it('returns unknown for empty UA', () => {
      expect(detectDevice(undefined)).toBe('unknown');
    });
  });

  describe('extractIp', () => {
    it('extracts the first IP from X-Forwarded-For', () => {
      expect(extractIp('10.0.0.1, 10.0.0.2', undefined)).toBe('10.0.0.1');
    });

    it('falls back to remoteAddress', () => {
      expect(extractIp(undefined, '192.168.1.1')).toBe('192.168.1.1');
    });

    it('returns unknown if no IP', () => {
      expect(extractIp(undefined, undefined)).toBe('unknown');
    });
  });

  describe('serializeBigInt', () => {
    it('serializes bigint to string', () => {
      expect(serializeBigInt(1_000_000n)).toBe('1000000');
    });
  });
});
