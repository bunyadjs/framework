import { CacheHit, CacheMissed, KeyForgotten, KeyWritten, CacheFlushed } from "@bunyad/cache";
import { listen as listenQueries } from "@bunyad/database";
import { getEventDispatcher } from "@bunyad/events";
import { listenLog } from "@bunyad/log";
import { listenException, statusFromError } from "@bunyad/core";
import { currentContext } from "../context.ts";
import { toExceptionRecord } from "../debugbar.ts";
import { sanitize, sanitizeRecord } from "../redact.ts";
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
      ctx.push(ctx.queries, {
        sql: event.sql,
        bindings: sanitize(event.bindings, options.redact) as unknown[],
        timeMs: event.timeMs,
        at: Math.max(0, ctx.now() - event.timeMs),
        duplicate: false,
        slow: event.timeMs >= options.slowQueryMs,
      });
    }),
  );

  disposers.push(
    listenLog((level, message, context) => {
      const ctx = currentContext();
      if (!ctx) return;
      ctx.push(ctx.logs, {
        level,
        message,
        at: ctx.now(),
        context: context ? sanitizeRecord(context, options.redact) : undefined,
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
