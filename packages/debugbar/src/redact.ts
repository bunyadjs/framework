const MASK = "********";
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

const SECRET_KEY =
  /pass(word|wd)?|secret|token|authorization|api[-_]?key|cookie|csrf|xsrf|credential|otp|pin\b|cvv|card|session/i;

export function isSecretKey(key: string, extra: RegExp[] = []): boolean {
  return SECRET_KEY.test(key) || extra.some((pattern) => pattern.test(key));
}

export function truncate(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max)}… (+${value.length - max})` : value;
}

/** Deep-clone `value` into JSON-safe data with secrets masked and strings capped. */
export function sanitize(value: unknown, extra: RegExp[] = [], depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[Binary ${value.byteLength} bytes]`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitize(item, extra, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key, extra) ? MASK : sanitize(item, extra, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeRecord(
  value: Record<string, unknown>,
  extra: RegExp[] = [],
): Record<string, unknown> {
  return sanitize(value, extra) as Record<string, unknown>;
}

export function sanitizeStrings(
  value: Record<string, string>,
  extra: RegExp[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSecretKey(key, extra) ? MASK : truncate(item);
  }
  return out;
}
