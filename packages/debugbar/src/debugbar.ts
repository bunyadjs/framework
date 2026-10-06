import { currentContext } from "./context.ts";
import type { MessageLevel } from "./types.ts";

/**
 * App-facing helpers. All are no-ops when the bar is off or outside a request,
 * so they are safe to leave in application code.
 */
export const Debugbar = {
  /** True inside a request the bar is recording. */
  active(): boolean {
    return currentContext() !== undefined;
  },

  /** Add a line to the Messages tab. */
  message(message: unknown, level: MessageLevel = "info"): void {
    const text = typeof message === "string" ? message : safeJson(message);
    currentContext()?.message(text, level);
  },

  startMeasure(label: string): void {
    currentContext()?.start(label);
  },

  stopMeasure(label: string): void {
    currentContext()?.stop(label);
  },

  /** Time a callback on the Timeline tab. Returns the callback's result. */
  async measure<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    const ctx = currentContext();
    if (!ctx) return fn();
    ctx.start(label);
    try {
      return await fn();
    } finally {
      ctx.stop(label);
    }
  },

  /** Record a caught exception without failing the request. */
  exception(error: unknown): void {
    currentContext()?.exceptions.push(toExceptionRecord(error, currentContext()!.now()));
  },
};

export function toExceptionRecord(error: unknown, at: number) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack ?? "", at };
  }
  return { name: "Error", message: safeJson(error), stack: "", at };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
