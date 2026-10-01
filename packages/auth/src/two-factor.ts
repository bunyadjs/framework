import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Crypt } from "@bunyad/common";
import { renderSVG } from "uqr";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const RECOVERY_CODE_COUNT = 8;

/** Columns a two-factor user stores (secret and codes are encrypted). */
export type TwoFactorColumns = {
  id: string | number;
  email?: string;
  two_factor_secret?: string | null;
  two_factor_recovery_codes?: string | null;
  two_factor_confirmed_at?: Date | string | null;
  save(): unknown;
};

/** Methods `@TwoFactorAuthenticatable()` adds to a model. */
export type TwoFactorAuthenticatableMethods = {
  hasEnabledTwoFactorAuthentication(): boolean;
  twoFactorSecret(): string;
  recoveryCodes(): string[];
  replaceRecoveryCode(code: string): Promise<void>;
  twoFactorQrCodeUrl(): string;
  twoFactorQrCodeSvg(): string;
};

type TwoFactorUser = TwoFactorColumns & TwoFactorAuthenticatableMethods;

let issuer = process.env.APP_NAME ?? "Bunyad";

/** Name shown in authenticator apps (the framework sets it from `app.name`). */
export function setTwoFactorIssuer(name: string): void {
  issuer = name;
}

/** Random base32 secret for an authenticator app (160 bits). */
export function generateSecretKey(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** RFC 6238 code for the 30-second step containing `timestamp` (ms). */
export function totp(secret: string, timestamp = Date.now()): string {
  return hotp(base32Decode(secret), Math.floor(timestamp / 1000 / STEP_SECONDS));
}

/**
 * The time step `code` matches, allowing `window` steps of clock drift either
 * way, or `false`.
 */
export function verifyTotp(
  secret: string,
  code: string,
  window = 1,
  timestamp = Date.now(),
): number | false {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secret);
  const current = Math.floor(timestamp / 1000 / STEP_SECONDS);
  for (let step = current - window; step <= current + window; step += 1) {
    if (safeEqual(hotp(key, step), code)) return step;
  }
  return false;
}

/** A recovery code: two groups of ten characters. */
export function generateRecoveryCode(): string {
  const chars = base32Encode(randomBytes(13)).slice(0, 20).toLowerCase();
  return `${chars.slice(0, 10)}-${chars.slice(10)}`;
}

/** Last accepted time step per secret, so a code can't be used twice. */
const usedSteps = new Map<string, number>();

/**
 * Enable, confirm, disable, and check two-factor authentication for a user
 * with the `@TwoFactorAuthenticatable()` columns.
 */
export const TwoFactor = {
  /** Store a new secret and recovery codes. Login is unaffected until `confirm`. */
  async enable(user: TwoFactorColumns): Promise<void> {
    user.two_factor_secret = Crypt.encryptString(generateSecretKey());
    user.two_factor_recovery_codes = encryptCodes(freshCodes());
    user.two_factor_confirmed_at = null;
    await user.save();
  },

  /** Turn two-factor on once the user proves their app shows the right code. */
  async confirm(user: TwoFactorUser, code: string): Promise<boolean> {
    if (!user.two_factor_secret || !(await TwoFactor.verify(user, code))) return false;
    user.two_factor_confirmed_at = new Date();
    await user.save();
    return true;
  },

  async disable(user: TwoFactorColumns): Promise<void> {
    user.two_factor_secret = null;
    user.two_factor_recovery_codes = null;
    user.two_factor_confirmed_at = null;
    await user.save();
  },

  async regenerateRecoveryCodes(user: TwoFactorColumns): Promise<void> {
    user.two_factor_recovery_codes = encryptCodes(freshCodes());
    await user.save();
  },

  /** Check a code from the user's authenticator app. Each code works once. */
  async verify(user: TwoFactorUser, code: string): Promise<boolean> {
    const secret = user.twoFactorSecret();
    const step = verifyTotp(secret, code.replace(/\s/g, ""));
    if (step === false) return false;
    const key = createHash("sha256").update(secret).digest("hex");
    if ((usedSteps.get(key) ?? -1) >= step) return false;
    usedSteps.set(key, step);
    return true;
  },

  /** Accept a recovery code and swap it for a new one. */
  async useRecoveryCode(user: TwoFactorUser, code: string): Promise<boolean> {
    const given = code.trim();
    if (!user.recoveryCodes().some((stored) => safeEqual(stored, given))) return false;
    await user.replaceRecoveryCode(given);
    return true;
  },
};

/**
 * Two-factor helpers for a model with `two_factor_secret`,
 * `two_factor_recovery_codes`, and `two_factor_confirmed_at` columns.
 *
 * @example
 * ```ts
 * @TwoFactorAuthenticatable()
 * class User extends Model {}
 * interface User extends TwoFactorAuthenticatableMethods {}
 * ```
 */
export function TwoFactorAuthenticatable(): ClassDecorator {
  return (target) => {
    Object.assign(target.prototype, twoFactorMethods);
  };
}

const twoFactorMethods: TwoFactorAuthenticatableMethods & ThisType<TwoFactorUser> = {
  hasEnabledTwoFactorAuthentication() {
    return Boolean(this.two_factor_secret && this.two_factor_confirmed_at);
  },

  twoFactorSecret() {
    return Crypt.decryptString(this.two_factor_secret!);
  },

  recoveryCodes() {
    if (!this.two_factor_recovery_codes) return [];
    return JSON.parse(Crypt.decryptString(this.two_factor_recovery_codes)) as string[];
  },

  async replaceRecoveryCode(code: string) {
    const codes = this.recoveryCodes().map((stored) =>
      stored === code ? generateRecoveryCode() : stored,
    );
    this.two_factor_recovery_codes = encryptCodes(codes);
    await this.save();
  },

  twoFactorQrCodeUrl() {
    const label = encodeURIComponent(`${issuer}:${this.email ?? this.id}`);
    const params = new URLSearchParams({
      secret: this.twoFactorSecret(),
      issuer,
      algorithm: "SHA1",
      digits: String(DIGITS),
      period: String(STEP_SECONDS),
    });
    return `otpauth://totp/${label}?${params}`;
  },

  twoFactorQrCodeSvg() {
    return renderSVG(this.twoFactorQrCodeUrl(), { border: 1 });
  },
};

function freshCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
}

function encryptCodes(codes: string[]): string {
  return Crypt.encryptString(JSON.stringify(codes));
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character [${char}].`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
