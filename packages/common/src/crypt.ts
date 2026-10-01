import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function isProduction(): boolean {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}

/** Explicit key override (tests / Crypt.setKey). */
let keyOverride: string | undefined;

/**
 * Resolve APP_KEY. Production refuses a missing key (no silent default).
 * Non-production may use Crypt.setKey() or APP_KEY; never ships a working
 * production default.
 */
export function resolveAppKey(): string {
  if (keyOverride !== undefined) return keyOverride;
  const raw = process.env.APP_KEY;
  if (raw && raw.length > 0) return raw;
  if (isProduction()) {
    throw new Error(
      "APP_KEY is not set. Generate one with Crypt.generateKey() and set APP_KEY before using encryption in production.",
    );
  }
  throw new Error(
    "APP_KEY is not set. Set APP_KEY or call Crypt.setKey() before encrypting/decrypting.",
  );
}

function appKey(): Buffer {
  const raw = resolveAppKey();
  if (raw.startsWith("base64:")) {
    const decoded = Buffer.from(raw.slice(7), "base64");
    if (decoded.byteLength >= 32) return decoded.subarray(0, 32);
    return createHash("sha256").update(decoded).digest();
  }
  return createHash("sha256").update(raw).digest();
}

let previousKeyBuffers: Buffer[] = [];

/**
 * Encrypt / decrypt strings (AES-256-GCM, keyed by `APP_KEY`).
 */
export const Crypt = {
  encrypt(value: string): string {
    return Crypt.encryptString(value);
  },

  decrypt(payload: string): string {
    return Crypt.decryptString(payload);
  },

  encryptString(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", appKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString("base64");
  },

  decryptString(payload: string): string {
    const keys = [appKey(), ...previousKeyBuffers];
    let lastError: unknown;
    for (const key of keys) {
      try {
        return decryptWithKey(payload, key);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Invalid encrypted payload.");
  },

  generateKey(): string {
    return `base64:${randomBytes(32).toString("base64")}`;
  },

  /**
   * Explicitly set the encryption key (dev/tests). Prefer APP_KEY in apps.
   * Pass `undefined` / call clearKey() to revert to env.
   */
  setKey(key: string | undefined): void {
    keyOverride = key;
  },

  clearKey(): void {
    keyOverride = undefined;
  },

  getKey(): string {
    return appKey().toString("base64");
  },

  previousKeys(keys: string[]): void {
    previousKeyBuffers = keys.map((raw) => {
      if (raw.startsWith("base64:")) {
        const decoded = Buffer.from(raw.slice(7), "base64");
        if (decoded.byteLength >= 32) return decoded.subarray(0, 32);
        return createHash("sha256").update(decoded).digest();
      }
      return createHash("sha256").update(raw).digest();
    });
  },

  supported(key: string, cipher = "aes-256-gcm"): boolean {
    void cipher;
    try {
      let buf: Buffer;
      if (key.startsWith("base64:")) {
        buf = Buffer.from(key.slice(7), "base64");
      } else {
        buf = Buffer.from(key);
      }
      return buf.byteLength === 16 || buf.byteLength === 24 || buf.byteLength === 32;
    } catch {
      return false;
    }
  },

  appearsEncrypted(value: unknown): boolean {
    if (typeof value !== "string" || value.length === 0) return false;
    try {
      const buf = Buffer.from(value, "base64");
      return buf.byteLength >= 28;
    } catch {
      return false;
    }
  },
};

function decryptWithKey(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.byteLength < 28) {
    throw new Error("Invalid encrypted payload.");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
