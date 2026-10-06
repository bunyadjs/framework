export const MASK = "********";
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

const SECRET_KEY =
  /pass(word|wd)?|secret|token|authorization|api[-_]?key|cookie|csrf|xsrf|credential|otp|pin\b|cvv|card|session/i;

/** Personal data keys, masked unless `redactPii: false`. Matched against column and field names. */
export const PII_KEYS: RegExp[] = [
  /e[-_]?mail/i,
  /phone|mobile|whatsapp|telephone/i,
  /address/i,
  /(?:^|[^a-z])(?:ssn|nid|passport|dob)(?:[^a-z]|$)/i,
  /national[-_]?id|tax[-_]?id|birth|iban|account[-_]?(?:no|number)|bank/i,
];

const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/;
const PASSWORD_HASH = /^\$(?:2[aby]|argon2(?:id|i|d))\$/;
const AUTH_SCHEME = /^(?:Bearer|Basic)\s+\S{8,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{40,}$/;

/** Mask a string that looks like a credential whatever field it sits in; cap the length otherwise. */
export function maskValue(value: string): string {
  if (JWT.test(value) || PASSWORD_HASH.test(value) || AUTH_SCHEME.test(value)) return MASK;
  if (OPAQUE_TOKEN.test(value) && !UUID.test(value)) return MASK;
  return truncate(value);
}

const TEXT_SECRET = /\b(password|passwd|secret|token|api[-_]?key|authorization|credential|cvv|otp)(["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s,"'&;}]+/gi;
const TEXT_BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi;
const TEXT_JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;

/** Best-effort masking of secrets inside free text such as log lines and error messages. */
export function redactText(text: string): string {
  return text
    .replace(TEXT_SECRET, `$1$2${MASK}`)
    .replace(TEXT_BEARER, `$1 ${MASK}`)
    .replace(TEXT_JWT, MASK);
}

export function isSecretKey(key: string, extra: RegExp[] = []): boolean {
  return SECRET_KEY.test(key) || extra.some((pattern) => pattern.test(key));
}

export function truncate(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max)}… (+${value.length - max})` : value;
}

/** Deep-clone `value` into JSON-safe data with secrets masked and strings capped. */
export function sanitize(value: unknown, extra: RegExp[] = [], depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return maskValue(value);
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
    out[key] = isSecretKey(key, extra) ? MASK : maskValue(item);
  }
  return out;
}
