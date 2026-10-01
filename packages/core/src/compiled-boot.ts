import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Compiled / production boot skips runtime Glob and config readdir.
 * Source-dev (`BUNYAD_DEV` / `BUNYAD_HOT`) keeps scanning for DX.
 *
 * Signals (first match wins after DEV/HOT veto):
 * - `BUNYAD_COMPILED=1` (set by `.build` entries and binary embeds)
 * - `.build/manifest.json` present and `NODE_ENV=production`
 */
export function isCompiledBootMode(basePath?: string): boolean {
  if (process.env.BUNYAD_DEV === "1" || process.env.BUNYAD_HOT === "1") {
    return false;
  }
  if (process.env.BUNYAD_COMPILED === "1") {
    return true;
  }
  if (
    basePath &&
    existsSync(join(basePath, ".build", "manifest.json")) &&
    process.env.NODE_ENV === "production"
  ) {
    return true;
  }
  return false;
}

export function compiledConfigModulePath(basePath: string): string {
  return join(basePath, ".build", "config.ts");
}

export function compiledConfigJsonPath(basePath: string): string {
  return join(basePath, ".build", "config.json");
}
