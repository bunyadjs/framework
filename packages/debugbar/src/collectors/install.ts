import { CacheHit, CacheMissed, KeyForgotten, KeyWritten, CacheFlushed } from "@bunyad/cache";
import { listen as listenQueries } from "@bunyad/database";
import { getEventDispatcher, listenDispatched } from "@bunyad/events";
import { listenLog } from "@bunyad/log";
import { listenException, statusFromError } from "@bunyad/core";
import { currentContext } from "../context.ts";
import { toExceptionRecord } from "../debugbar.ts";
import { captureOrigin } from "../origin.ts";
import { createHash } from "node:crypto";
import { MASK, isSecretKey, redactText, sanitize, sanitizeRecord, truncate } from "../redact.ts";
import { redactBindings, redactLiterals } from "../sql-redact.ts";
import type { CacheRecord, ResolvedDebugbarOptions } from "../types.ts";

/**
 * Subscribe the passive collectors (queries, logs, cache). Each listener is a no-op
 * unless a debugged request context is active. Returns one disposer for all of them.
 */
export function installCollectors(options: ResolvedDebugbarOptions): () => void {
  // One live install at a time: re-booting (tests, hot reload) replaces the previous one.
  uninstall?.();
  const disposers: Array<() => void> = [];

  disposers.push(
    listenQueries((event) => {
      const ctx = currentContext();
      if (!ctx) return;
      const sensitive = (column: string) => isSecretKey(column, options.redact);
      const masked = redactBindings(event.sql, event.bindings, sensitive).map((value) => sanitize(value, options.redact));
      ctx.push(ctx.queries, {
        sql: redactLiterals(event.sql, sensitive),
        bindings: options.captureBindings ? masked : masked.map(() => "[hidden]"),
        timeMs: event.timeMs,
        at: Math.max(0, ctx.now() - event.timeMs),
        duplicate: false,
        slow: event.timeMs >= options.slowQueryMs,
        fingerprint: fingerprint(event.bindings),
        nPlusOne: false,
        repeats: 0,
        origin: options.queryOrigin ? captureOrigin() : null,
      });
    }),
  );

  disposers.push(
    listenLog((level, message, context) => {
      const ctx = currentContext();
      if (!ctx) return;
      ctx.push(ctx.logs, {
        level,
        message: redactText(message),
        at: ctx.now(),
        context: context ? sanitizeRecord(context, options.redact) : undefined,
      });
    }),
  );

  disposers.push(
    listenDispatched((event) => {
      const ctx = currentContext();
      if (!ctx || ignored(event.name, options.eventsIgnore)) return;
      ctx.push(ctx.events, {
        name: event.name,
        listeners: event.listeners,
        timeMs: event.timeMs,
        at: ctx.now(),
        failed: event.failed,
        payload: payloadJson(event.payload, options),
      });
    }),
  );

  disposers.push(
    listenException((error) => {
      const ctx = currentContext();
      if (!ctx || statusFromError(error) < 500) return;
      ctx.push(ctx.exceptions, toExceptionRecord(error, ctx.now()));
    }),
  );

  disposers.push(listenCacheEvents());

  uninstall = () => {
    for (const dispose of disposers) dispose();
    uninstall = undefined;
  };
  return uninstall;
}

let uninstall: (() => void) | undefined;

/** Dispatchers already tapped — the event API has no unlisten, so we tap once and gate on `enabled`. */
const tapped = new WeakSet<object>();
let cacheEnabled = false;

function listenCacheEvents(): () => void {
  cacheEnabled = true;
  const dispatcher = getEventDispatcher();
  if (!dispatcher || tapped.has(dispatcher)) {
    return () => {
      cacheEnabled = false;
    };
  }
  tapped.add(dispatcher);

  const record = (type: CacheRecord["type"], key: string, store: string | null) => {
    const ctx = currentContext();
    if (!cacheEnabled || !ctx) return;
    ctx.push(ctx.cache, { type, key, store, at: ctx.now() });
  };
  type KeyEvent = { key: string; store: string | null };

  dispatcher.listen(CacheHit, ((e: KeyEvent) => record("hit", e.key, e.store)) as never);
  dispatcher.listen(CacheMissed, ((e: KeyEvent) => record("miss", e.key, e.store)) as never);
  dispatcher.listen(KeyWritten, ((e: KeyEvent) => record("write", e.key, e.store)) as never);
  dispatcher.listen(KeyForgotten, ((e: KeyEvent) => record("forget", e.key, e.store)) as never);
  dispatcher.listen(CacheFlushed, ((e: { store: string | null }) => record("flush", "*", e.store)) as never);

  return () => {
    cacheEnabled = false;
  };
}

function ignored(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern,
  );
}

function payloadJson(payload: object, options: ResolvedDebugbarOptions): string {
  try {
    return truncate(JSON.stringify(sanitize(payload, options.redact)) ?? "", 1500);
  } catch {
    return "[unserializable]";
  }
}

/** Stable, non-reversible-by-eye id of the original bindings, used only to compare queries in memory. */
function fingerprint(bindings: unknown[]): string {
  const json = JSON.stringify(bindings, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) ?? "";
  return createHash("sha1").update(json).digest("hex").slice(0, 12);
}
