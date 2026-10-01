import { createRequire } from "node:module";
import type { PasswordPlatform } from "../password.ts";

const require = createRequire(import.meta.url);

type BcryptLike = {
  hash(data: string, rounds: number): Promise<string>;
  hashSync(data: string, rounds: number): string;
  compare(data: string, encrypted: string): Promise<boolean>;
};

let cached: BcryptLike | null = null;

/**
 * Prefer native `bcrypt`; fall back to `bcryptjs` when the native addon is
 * unavailable. Fail-fast naming the peers if neither is installed.
 */
export function loadNodeBcrypt(): BcryptLike {
  if (cached) return cached;
  try {
    cached = require("bcrypt") as BcryptLike;
    return cached;
  } catch {
    /* try bcryptjs */
  }
  try {
    cached = require("bcryptjs") as BcryptLike;
    return cached;
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";
    throw new Error(
      'Missing optional peer dependency "bcrypt" (preferred) or "bcryptjs" (fallback). Install one for the Node password platform / ORM `hashed` cast: npm install bcrypt' +
        detail,
    );
  }
}

/** Node password adapter — bcrypt-compatible `$2…` (Bun.password golden-vector). */
export const password: PasswordPlatform = {
  hash(value, options) {
    return loadNodeBcrypt().hash(value, options.cost);
  },
  hashSync(value, options) {
    return loadNodeBcrypt().hashSync(value, options.cost);
  },
  verify(value, hash) {
    return loadNodeBcrypt().compare(value, hash);
  },
};
