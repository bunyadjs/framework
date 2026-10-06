import { RequestContext, currentContext, runWithContext } from "./context.ts";
import { redactText } from "./redact.ts";
import { buildProfileSnapshot } from "./snapshot.ts";
import { activeDebugbar } from "./state.ts";
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
    currentContext()?.message(redactText(text), level);
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

  /**
   * Record work that is not an HTTP request (a queued job, a scheduled task, a command) as its own
   * entry in the history, with its queries, logs, events and errors. Returns what `fn` returns and
   * rethrows what it throws. Does nothing but run `fn` when the bar is off.
   *
   * Inside a request (or another profiled run) it adds a Timeline span instead of a new entry.
   */
  async profile<T>(label: string, fn: () => T | Promise<T>, options: { kind?: "job" | "schedule" | "command" } = {}): Promise<T> {
    if (currentContext()) return Debugbar.measure(label, fn);
    const bar = activeDebugbar();
    if (!bar || bar.except.some((prefix) => label.startsWith(prefix))) return fn();

    const context = new RequestContext(undefined, bar.maxRecords, options.kind ?? "job", label);
    try {
      return await runWithContext(context, async () => fn());
    } catch (error) {
      context.failed = true;
      context.exceptions.push(toExceptionRecord(error, context.now()));
      throw error;
    } finally {
      try {
        await bar.store.put(buildProfileSnapshot(context, bar));
      } catch {
        // Dev tooling only: a failing store must never fail the job being profiled.
      }
    }
  },

  /** Record a caught exception without failing the request. */
  exception(error: unknown): void {
    currentContext()?.exceptions.push(toExceptionRecord(error, currentContext()!.now()));
  },
};

export function toExceptionRecord(error: unknown, at: number) {
  if (error instanceof Error) {
    return { name: error.name, message: redactText(error.message), stack: redactText(error.stack ?? ""), at };
  }
  return { name: "Error", message: redactText(safeJson(error)), stack: "", at };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
