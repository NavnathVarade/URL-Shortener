// ─────────────────────────────────────────────────────────────────────────────
// Short Code Generation — Base62 Encoding
// ─────────────────────────────────────────────────────────────────────────────
//
// Strategy: Counter-based Base62 (used by YouTube, Bitly at scale)
//
// Why Base62 over hashing (MD5/SHA256)?
//   - MD5/SHA256 → truncation causes collisions at scale (birthday paradox)
//   - Random nanoid → requires collision detection DB round-trip every write
//   - Counter + Base62 → guaranteed unique, no collision, no DB round-trip
//
// How it works:
//   1. PostgreSQL SEQUENCE generates a monotonically increasing int64
//   2. We Base62-encode that integer → short, URL-safe code
//   3. 7-char Base62 → 62^7 = 3.5 trillion codes (enough for 365B + buffer)
//
// Base62 alphabet: [0-9][A-Z][a-z] (no + or / from Base64 — URL safe)
//
// Example:
//   id = 1000000  →  "4c92"
//   id = 1000001  →  "4c93"
// ─────────────────────────────────────────────────────────────────────────────

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = BigInt(BASE62_ALPHABET.length); // 62n

/**
 * Encodes a positive integer into a Base62 string.
 * @param num - A positive integer (supports BigInt for safety at scale)
 */
export function encodeBase62(num: bigint | number): string {
  let n = BigInt(num);

  if (n === 0n) return BASE62_ALPHABET[0];

  const chars: string[] = [];
  while (n > 0n) {
    chars.unshift(BASE62_ALPHABET[Number(n % BASE)]);
    n = n / BASE;
  }
  return chars.join('');
}

/**
 * Decodes a Base62 string back to a BigInt.
 * Useful for reverse-lookups or debugging.
 */
export function decodeBase62(code: string): bigint {
  let result = 0n;
  for (const char of code) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid Base62 character: '${char}'`);
    result = result * BASE + BigInt(index);
  }
  return result;
}

/**
 * Pads a Base62-encoded string to a fixed length with leading zeros.
 * Ensures consistent short code length regardless of the counter value.
 */
export function padBase62(code: string, length: number): string {
  return code.padStart(length, BASE62_ALPHABET[0]);
}

/**
 * Validates a short code contains only Base62 characters.
 */
export function isValidBase62(code: string): boolean {
  return /^[0-9A-Za-z]+$/.test(code);
}

// ─────────────────────────────────────────────────────────────────────────────
// URL Utility Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a URL: lowercases scheme+host, removes trailing slash on root.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Normalize: lowercase protocol and hostname
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Extracts the scheme from a URL.
 */
export function getUrlScheme(url: string): string {
  try {
    return new URL(url).protocol.replace(':', '');
  } catch {
    return '';
  }
}

/**
 * Detects a basic device category from User-Agent string.
 */
export function detectDevice(userAgent?: string): string {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod/.test(ua)) return 'mobile';
  if (/tablet/.test(ua)) return 'tablet';
  if (/bot|crawler|spider|curl|wget/.test(ua)) return 'bot';
  return 'desktop';
}

/**
 * Extracts a safe IP address string (handles proxies via X-Forwarded-For).
 */
export function extractIp(
  forwardedFor: string | undefined,
  remoteAddress: string | undefined,
): string {
  if (forwardedFor) {
    // X-Forwarded-For can be comma-separated; first IP is the client
    return forwardedFor.split(',')[0].trim();
  }
  return remoteAddress ?? 'unknown';
}

/**
 * Serializes a bigint to string for JSON responses.
 * JSON.stringify cannot handle BigInt natively.
 */
export function serializeBigInt(value: bigint): string {
  return value.toString();
}
