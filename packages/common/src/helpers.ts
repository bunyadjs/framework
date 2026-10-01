import { inspect } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { Collection } from "./collection.ts";
import { DdException } from "./dd-exception.ts";
import {
  renderDdHtmlPage,
  resolveDumpValues,
  serializeDumpValue,
} from "./var-dumper.ts";

export { DdException } from "./dd-exception.ts";

type DdStore = { mode: "http" | "throw" };

const ddStorage = new AsyncLocalStorage<DdStore>();
const THROW_DD_STORE: DdStore = { mode: "throw" };
let forceThrow = false;
/** Nested HTTP kernel depth — avoids AsyncLocalStorage on the request hot path. */
let httpDdDepth = 0;
/** Process-wide HTTP mode (fetch handler) — `dd()` throws without per-request wrapping. */
let httpDdEnabled = false;

/**
 * Force `dd()` to throw instead of `process.exit` (for unit tests).
 * Prefer wrapping with `runWithDdThrow` when possible.
 */
export function useDdThrow(enabled = true): void {
  forceThrow = enabled;
}

/** Run `fn` so `dd()` throws `DdException` instead of exiting. */
export function runWithDdThrow<T>(fn: () => T): T {
  return ddStorage.run(THROW_DD_STORE, fn);
}

/**
 * Run an HTTP request scope so `dd()` throws (kernel renders a dump page)
 * instead of killing the whole Bun process.
 */
export function runWithHttpDd<T>(fn: () => T): T {
  httpDdDepth++;
  try {
    return fn();
  } finally {
    httpDdDepth--;
  }
}

/** After this, `dd()` throws in this process (used by the HTTP fetch handler). */
export function enableHttpDd(): void {
  httpDdEnabled = true;
}

/**
 * Format dumped values as an interactive HTML dump page for the browser.
 */
export function ddHtmlPage(values: unknown[]): string {
  return renderDdHtmlPage(values, "dark");
}

/** Await thenables inside `dd()` payloads (HTTP kernel). */
export { resolveDumpValues };

/**
 * `blank` — null, empty/whitespace string, empty array/Collection.
 * Note: `0` and `false` are not blank.
 */
export function blank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Collection) return value.isEmpty();
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  return false;
}

/** `filled` — opposite of `blank`. */
export function filled(value: unknown): boolean {
  return !blank(value);
}

function envBag(): Record<string, string | undefined> {
  return typeof Bun !== "undefined" && Bun.env
    ? (Bun.env as Record<string, string | undefined>)
    : (process.env as Record<string, string | undefined>);
}

/** Control-plane ingest URL injected by Flock workers (`FLOCK_DUMP_URL` or `FLOCK_DUMP_SOCKET`). */
export function flockDumpUrl(): string | undefined {
  const bag = envBag();
  const url = bag.FLOCK_DUMP_URL || bag.FLOCK_DUMP_SOCKET;
  return url ? url : undefined;
}

export type FlockIngestKind =
  | "dump"
  | "dd"
  | "query"
  | "job"
  | "view"
  | "http"
  | "log";

function callerLocation(): { file?: string; line?: number } {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(2)) {
    if (line.includes("helpers.ts") || line.includes("node:internal")) {
      continue;
    }
    const match = line.match(/\(?([^\s()]+):(\d+):\d+\)?/);
    if (match) {
      return { file: match[1], line: Number(match[2]) };
    }
  }
  return {};
}

/** POST debug events when `FLOCK_DUMP_URL` is set. Skip stack walking on hot paths (`locate: false`). */
export function flockIngest(
  kind: FlockIngestKind,
  payload: Record<string, unknown> = {},
  options: { locate?: boolean } = {},
): Promise<void> {
  const url = flockDumpUrl();
  if (!url || !url.startsWith("http")) {
    return Promise.resolve();
  }
  const loc = options.locate === false ? {} : callerLocation();
  const body = {
    kind,
    createdAt: new Date().toISOString(),
    site: envBag().FLOCK_SITE,
    file: loc.file,
    line: loc.line,
    ...payload,
  };
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** POST dump/dd payloads to Flock when `FLOCK_DUMP_URL` is set. */
export async function postFlockDump(
  kind: "dump" | "dd",
  values: unknown[],
): Promise<void> {
  const resolved = await resolveDumpValues(values);
  const serialized = resolved.map((value) => serializeDumpValue(value));
  return flockIngest(kind, {
    value: serialized.length === 1 ? serialized[0] : serialized,
    html: renderDdHtmlPage(resolved),
  });
}

function printDump(values: unknown[]): void {
  for (const value of values) {
    console.log(
      inspect(value, {
        depth: 8,
        colors: true,
        getters: true,
        showHidden: false,
      }),
    );
  }
}

/** `dump` — print values and continue. */
export function dump(...values: unknown[]): void {
  printDump(values);
  void postFlockDump("dump", values);
}

/**
 * `dd` — dump and die.
 * - CLI / default: `process.exit(1)`
 * - Inside HTTP request (`runWithHttpDd`): throws `DdException` for a dump response
 * - Tests: `useDdThrow()` or `runWithDdThrow(() => dd(...))`
 */
export function dd(...values: unknown[]): never {
  printDump(values);
  void postFlockDump("dd", values);
  if (forceThrow || httpDdEnabled || httpDdDepth > 0 || ddStorage.getStore()) {
    throw new DdException(values);
  }
  process.exit(1);
}

/**
 * Laravel `tap` — run callback with value, return value.
 */
export function tap<T>(value: T, callback?: (value: T) => void): T {
  callback?.(value);
  return value;
}

/**
 * Laravel `value` — invoke if Closure/function, otherwise return as-is.
 */
export function value<T>(val: T | (() => T)): T {
  return typeof val === "function" ? (val as () => T)() : val;
}

/**
 * Laravel `with` — pass value to callback and return its result (or value).
 */
export function withValue<T, R = T>(
  val: T,
  callback?: (value: T) => R,
): T | R {
  return callback === undefined ? val : callback(val);
}

/**
 * Laravel `when` — if condition is truthy return `$value`, else `$default`.
 * Closures are invoked.
 */
export function when<T, D = undefined>(
  condition: unknown,
  val: T | (() => T),
  defaultValue?: D | (() => D),
): T | D | undefined {
  if (condition) return value(val);
  if (arguments.length < 3) return undefined;
  return value(defaultValue as D | (() => D));
}

/**
 * Laravel `optional` — null-safe access.
 * With callback: invoke only when value is present.
 * Without: return value or a null-returning proxy.
 */
export function optional<T>(
  val: T | null | undefined,
): T | OptionalProxy;
export function optional<T, R>(
  val: T | null | undefined,
  callback: (value: T) => R,
): R | null;
export function optional<T, R>(
  val: T | null | undefined,
  callback?: (value: T) => R,
): T | R | null | OptionalProxy {
  if (callback) {
    return val == null ? null : callback(val);
  }
  if (val == null) return createOptionalProxy();
  return val;
}

type OptionalProxy = Record<string | symbol, unknown>;

function createOptionalProxy(): OptionalProxy {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => null;
      if (prop === "valueOf") return () => null;
      if (prop === "toString") return () => "";
      if (prop === "then") return undefined; // not a thenable
      return createOptionalProxy();
    },
  };
  return new Proxy({}, handler);
}

/** Laravel `throw_if`. */
export function throw_if(
  condition: unknown,
  error: string | Error | (new (...args: never[]) => Error) = Error,
  ...args: unknown[]
): asserts condition is false | 0 | "" | null | undefined {
  if (!condition) return;
  throw resolveThrowable(error, args);
}

/** Laravel `throw_unless`. */
export function throw_unless(
  condition: unknown,
  error: string | Error | (new (...args: never[]) => Error) = Error,
  ...args: unknown[]
): asserts condition {
  if (condition) return;
  throw resolveThrowable(error, args);
}

function resolveThrowable(
  error: string | Error | (new (...args: never[]) => Error),
  args: unknown[],
): Error {
  if (typeof error === "string") return new Error(error);
  if (error instanceof Error) return error;
  try {
    return new (error as new (...a: unknown[]) => Error)(...args);
  } catch {
    return new Error(String(error));
  }
}

/**
 * Laravel `retry` — retry a callback on failure.
 */
export async function retry<T>(
  times: number,
  callback: (attempt: number) => T | Promise<T>,
  sleepMilliseconds: number | ((attempt: number) => number) = 0,
  when?: (error: unknown) => boolean,
): Promise<T> {
  let attempts = Math.max(1, Math.floor(times));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await callback(attempt);
    } catch (error) {
      lastError = error;
      if (when && !when(error)) throw error;
      if (attempt >= attempts) break;
      const delay =
        typeof sleepMilliseconds === "function"
          ? sleepMilliseconds(attempt)
          : sleepMilliseconds;
      if (delay > 0) await Bun.sleep(delay);
    }
  }

  throw lastError;
}

const onceByKey = new Map<string, unknown>();
const onceByFn = new WeakMap<(...args: never[]) => unknown, unknown>();

/**
 * Laravel `once` — memoize a callback result.
 *
 * - `once(key, fn)` — stable across calls (preferred on Bun; call-site stacks are unreliable)
 * - `once(fn)` — memoizes by function identity (hoist the closure to reuse)
 */
export function once<T>(callback: () => T): T;
export function once<T>(key: string, callback: () => T): T;
export function once<T>(
  keyOrCallback: string | (() => T),
  maybeCallback?: () => T,
): T {
  if (typeof keyOrCallback === "string") {
    const key = keyOrCallback;
    const callback = maybeCallback!;
    if (onceByKey.has(key)) return onceByKey.get(key) as T;
    const result = callback();
    onceByKey.set(key, result);
    return result;
  }

  const callback = keyOrCallback;
  if (onceByFn.has(callback)) return onceByFn.get(callback) as T;
  const result = callback();
  onceByFn.set(callback, result);
  return result;
}

/** Clear keyed `once()` memoization (Laravel `Once::flush()`). */
export function flushOnce(): void {
  onceByKey.clear();
}

type DeferredJob = {
  callback: () => void | Promise<void>;
  always: boolean;
};

const deferredJobs: DeferredJob[] = [];

/**
 * Laravel `defer` — queue work to run after the current turn / response.
 * Call `flushDeferred()` from the HTTP kernel (or manually in CLI/tests).
 */
export function defer(
  callback: () => void | Promise<void>,
): { always: () => void } {
  const job: DeferredJob = { callback, always: false };
  deferredJobs.push(job);
  return {
    always() {
      job.always = true;
    },
  };
}

const FLUSH_OK = { failed: false } as const;

/** Run and clear deferred callbacks (skips non-always on failure if `failed`). */
export function flushDeferred(options: {
  failed?: boolean;
} = FLUSH_OK): void | Promise<void> {
  if (deferredJobs.length === 0) return;
  return flushDeferredAsync(options.failed === true);
}

async function flushDeferredAsync(failed: boolean): Promise<void> {
  const jobs = deferredJobs.splice(0, deferredJobs.length);
  for (const job of jobs) {
    if (failed && !job.always) continue;
    await job.callback();
  }
}

/** Laravel `now` — current `Date`. */
export function now(): Date {
  return new Date();
}

/** Laravel `today` — start of today (local midnight). */
export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Laravel `env` — read environment variable with optional default.
 * Uses `Bun.env` when available, else `process.env`.
 */
export function env(key: string, defaultValue?: string): string | undefined {
  const bag =
    typeof Bun !== "undefined" && Bun.env
      ? (Bun.env as Record<string, string | undefined>)
      : (process.env as Record<string, string | undefined>);
  const raw = bag[key];
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  return raw;
}

/** Laravel `report` — log an exception (no custom handler wired yet). */
export function report(error: unknown): void {
  if (error instanceof Error) {
    console.error(error);
  } else {
    console.error(String(error));
  }
}

/**
 * Laravel `rescue` — run callback, return rescue value on failure.
 */
export function rescue<T, R = null>(
  callback: () => T,
  rescueValue?: R | ((error: unknown) => R),
  shouldReport = true,
): T | R {
  try {
    return callback();
  } catch (error) {
    if (shouldReport) report(error);
    if (typeof rescueValue === "function") {
      return (rescueValue as (error: unknown) => R)(error);
    }
    return (rescueValue === undefined ? null : rescueValue) as R;
  }
}

/**
 * Async variant of `rescue` for promise-returning work.
 */
export async function rescueAsync<T, R = null>(
  callback: () => T | Promise<T>,
  rescueValue?: R | ((error: unknown) => R),
  shouldReport = true,
): Promise<T | R> {
  try {
    return await callback();
  } catch (error) {
    if (shouldReport) report(error);
    if (typeof rescueValue === "function") {
      return (rescueValue as (error: unknown) => R)(error);
    }
    return (rescueValue === undefined ? null : rescueValue) as R;
  }
}
