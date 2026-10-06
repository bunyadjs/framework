import { resolve } from "node:path";
import type { QueryOrigin } from "./types.ts";

/** Directory holding the `@bunyad/*` packages when they are linked from a checkout. */
const FRAMEWORK_ROOT = resolve(import.meta.dir, "..", "..");

/** A real source file: POSIX or Windows absolute path. */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/;

const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** `<root>/<package>/src/...` — a linked `@bunyad/*` package's own code, not its tests. */
function isFrameworkSource(file: string): boolean {
  return file.startsWith(FRAMEWORK_ROOT + "/") && file.indexOf("/src/", FRAMEWORK_ROOT.length) !== -1;
}

function isInternal(file: string): boolean {
  return (
    file.startsWith("node:") ||
    file.startsWith("bun:") ||
    file.includes("/node_modules/") ||
    isFrameworkSource(file)
  );
}

function relative(file: string, cwd: string): string {
  return file.startsWith(cwd + "/") ? file.slice(cwd.length + 1) : file;
}

/** Parse a stack and return the first frame that is application code. */
export function originFromStack(stack: string, cwd = process.cwd()): QueryOrigin | null {
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const file = match[2]!.replace(/^file:\/\//, "");
    // Runtime frames such as `native:7` or `<anonymous>` are not files; skip them.
    if (!ABSOLUTE.test(file) || isInternal(file)) continue;
    return {
      file: relative(file, cwd),
      line: Number(match[3]),
      function: match[1]?.replace(/^async /, "") ?? null,
    };
  }
  return null;
}

/** Where in application code the current query was issued. Dev-only cost. */
export function captureOrigin(): QueryOrigin | null {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  try {
    return originFromStack(new Error().stack ?? "");
  } finally {
    Error.stackTraceLimit = limit;
  }
}
