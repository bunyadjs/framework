import type { CreateGlob, FileGlob } from "../glob.ts";

/** Bun.Glob adapter for migrator file discovery. */
export const createGlob: CreateGlob = (pattern: string): FileGlob => {
  const glob = new Bun.Glob(pattern);
  return {
    scan(options: { cwd: string }) {
      return glob.scan({ cwd: options.cwd });
    },
  };
};
