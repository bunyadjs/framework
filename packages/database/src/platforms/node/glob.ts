import * as fsPromises from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CreateGlob, FileGlob } from "../glob.ts";

type NativeGlob = (
  pattern: string,
  options: { cwd: string },
) => AsyncIterable<string>;

/** `fs.promises.glob` exists on Node 22+; `import *` keeps Node 20 from failing at load time. */
const nativeGlob = (fsPromises as { glob?: NativeGlob }).glob;

/** Turn a glob (`*`, `**`, `?`) into an anchored regular expression over `/`-separated paths. */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more directories; a trailing `**` matches anything.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

async function* walk(root: string, relative = ""): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(root, path);
    else if (entry.isFile()) yield path;
  }
}

/** Built-in matcher: walks `cwd` and keeps files whose relative path matches the pattern. */
export const createWalkGlob: CreateGlob = (pattern: string): FileGlob => {
  const matcher = globToRegExp(pattern);
  return {
    async *scan(options: { cwd: string }) {
      for await (const path of walk(options.cwd)) {
        if (matcher.test(path)) yield path;
      }
    },
  };
};

/**
 * Node glob adapter for migrator discovery. Uses `fs.promises.glob` when the runtime has it
 * (Node 22+) and the built-in matcher otherwise (Node 20).
 * Yields paths relative to `cwd`, matching Bun.Glob.scan behaviour.
 */
export const createGlob: CreateGlob = (pattern: string): FileGlob => {
  if (!nativeGlob) return createWalkGlob(pattern);
  return {
    async *scan(options: { cwd: string }) {
      for await (const entry of nativeGlob(pattern, { cwd: options.cwd })) {
        yield entry;
      }
    },
  };
};

/** Exposed for tests: the Node 20 fallback pattern compiler. */
export const __globToRegExp = globToRegExp;
