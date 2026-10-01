import { glob as fsGlob } from "node:fs/promises";
import type { CreateGlob, FileGlob } from "../glob.ts";

/**
 * Node glob adapter for migrator discovery (`fs.promises.glob`).
 * Yields paths relative to `cwd`, matching Bun.Glob.scan behaviour.
 */
export const createGlob: CreateGlob = (pattern: string): FileGlob => {
  return {
    async *scan(options: { cwd: string }) {
      for await (const entry of fsGlob(pattern, { cwd: options.cwd })) {
        yield entry;
      }
    },
  };
};
