import { resolve } from "node:path";

/** True when `path` lives on Bun's read-only compile filesystem. */
export function isBunEmbeddedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.includes("/$bunfs");
}

/**
 * Resolve the application root.
 *
 * Dev / `bun` runs use `import.meta.dir/..`. Compiled binaries (`bun build
 * --compile`) embed sources under `/$bunfs` (read-only), so the root falls
 * back to `BUNYAD_BASE_PATH` or `process.cwd()` — run the binary from the app
 * directory (or set the env var).
 */
export function resolveAppBasePath(importMetaDir: string): string {
  if (process.env.BUNYAD_BASE_PATH) {
    return resolve(process.env.BUNYAD_BASE_PATH);
  }
  if (isBunEmbeddedPath(importMetaDir)) {
    return process.cwd();
  }
  return resolve(importMetaDir, "..");
}
