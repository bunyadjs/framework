/**
 * Install support helpers on `globalThis` so apps can call them without importing.
 */
import { Collection, collect } from "./collection.ts";
import {
  blank,
  dd,
  defer,
  dump,
  env,
  filled,
  flushDeferred,
  flushOnce,
  now,
  once,
  optional,
  report,
  rescue,
  rescueAsync,
  retry,
  tap,
  throw_if,
  throw_unless,
  today,
  value,
  when,
  withValue,
} from "./helpers.ts";

export type BunyadCommonGlobalHelpers = {
  dd: typeof dd;
  dump: typeof dump;
  blank: typeof blank;
  filled: typeof filled;
  collect: typeof collect;
  tap: typeof tap;
  value: typeof value;
  withValue: typeof withValue;
  when: typeof when;
  optional: typeof optional;
  throw_if: typeof throw_if;
  throw_unless: typeof throw_unless;
  retry: typeof retry;
  once: typeof once;
  flushOnce: typeof flushOnce;
  defer: typeof defer;
  flushDeferred: typeof flushDeferred;
  now: typeof now;
  today: typeof today;
  env: typeof env;
  report: typeof report;
  rescue: typeof rescue;
  rescueAsync: typeof rescueAsync;
};

let installed = false;

/** Idempotent — safe to call from multiple entrypoints. */
export function installGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as typeof globalThis &
    Partial<BunyadCommonGlobalHelpers>;
  g.dd = dd;
  g.dump = dump;
  g.blank = blank;
  g.filled = filled;
  g.collect = collect;
  g.tap = tap;
  g.value = value;
  g.withValue = withValue;
  g.when = when;
  g.optional = optional;
  g.throw_if = throw_if;
  g.throw_unless = throw_unless;
  g.retry = retry;
  g.once = once;
  g.flushOnce = flushOnce;
  g.defer = defer;
  g.flushDeferred = flushDeferred;
  g.now = now;
  g.today = today;
  g.env = env;
  g.report = report;
  g.rescue = rescue;
  g.rescueAsync = rescueAsync;
}

declare global {
  function dd(...values: unknown[]): never;
  function dump(...values: unknown[]): void;
  function blank(value: unknown): boolean;
  function filled(value: unknown): boolean;
  function collect<T = unknown>(
    items?: T[] | Collection<T> | Iterable<T> | null,
  ): Collection<T>;
  function tap<T>(value: T, callback?: (value: T) => void): T;
  function value<T>(val: T | (() => T)): T;
  function withValue<T, R = T>(
    val: T,
    callback?: (value: T) => R,
  ): T | R;
  function when<T, D = undefined>(
    condition: unknown,
    val: T | (() => T),
    defaultValue?: D | (() => D),
  ): T | D | undefined;
  function optional<T>(val: T | null | undefined): T | Record<string | symbol, unknown>;
  function optional<T, R>(
    val: T | null | undefined,
    callback: (value: T) => R,
  ): R | null;
  function throw_if(
    condition: unknown,
    error?: string | Error | (new (...args: never[]) => Error),
    ...args: unknown[]
  ): asserts condition is false | 0 | "" | null | undefined;
  function throw_unless(
    condition: unknown,
    error?: string | Error | (new (...args: never[]) => Error),
    ...args: unknown[]
  ): asserts condition;
  function retry<T>(
    times: number,
    callback: (attempt: number) => T | Promise<T>,
    sleepMilliseconds?: number | ((attempt: number) => number),
    when?: (error: unknown) => boolean,
  ): Promise<T>;
  function once<T>(callback: () => T): T;
  function once<T>(key: string, callback: () => T): T;
  function flushOnce(): void;
  function defer(
    callback: () => void | Promise<void>,
  ): { always: () => void };
  function flushDeferred(options?: { failed?: boolean }): void | Promise<void>;
  function now(): Date;
  function today(): Date;
  function env(key: string, defaultValue?: string): string | undefined;
  function report(error: unknown): void;
  function rescue<T, R = null>(
    callback: () => T,
    rescueValue?: R | ((error: unknown) => R),
    shouldReport?: boolean,
  ): T | R;
  function rescueAsync<T, R = null>(
    callback: () => T | Promise<T>,
    rescueValue?: R | ((error: unknown) => R),
    shouldReport?: boolean,
  ): Promise<T | R>;
}

installGlobals();
