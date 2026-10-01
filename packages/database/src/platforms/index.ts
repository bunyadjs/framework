/**
 * Platform hooks (password, glob). Resolves Bun vs Node at call time so shared
 * modules (migrator) and package consumers pick the correct adapter.
 */
import type { PasswordPlatform } from "./password.ts";
import type { CreateGlob } from "./glob.ts";
import {
  password as bunPassword,
  createGlob as bunCreateGlob,
} from "./bun/index.ts";
import {
  password as nodePassword,
  createGlob as nodeCreateGlob,
} from "./node/index.ts";

export type { PasswordPlatform, PasswordHashOptions } from "./password.ts";
export type { FileGlob, CreateGlob } from "./glob.ts";

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
}

export const password: PasswordPlatform = {
  hash(value, options) {
    return (isBunRuntime() ? bunPassword : nodePassword).hash(value, options);
  },
  hashSync(value, options) {
    return (isBunRuntime() ? bunPassword : nodePassword).hashSync(
      value,
      options,
    );
  },
  verify(value, hash) {
    return (isBunRuntime() ? bunPassword : nodePassword).verify(value, hash);
  },
};

export const createGlob: CreateGlob = (pattern) =>
  (isBunRuntime() ? bunCreateGlob : nodeCreateGlob)(pattern);
