import type { CacheStore } from "@bunyad/contracts";
import { CacheFake } from "./cache-fake.ts";
import { MemoizedStore } from "./memoized-store.ts";
import type { TaggedCache } from "./tagged-cache.ts";
import { CacheLock, CACHE_LOCK_PREFIX } from "./lock.ts";
import {
  CacheHit,
  CacheMissed,
  KeyWritten,
  KeyForgotten,
  CacheFlushed,
  dispatchCacheEvent,
} from "./events.ts";
import { ConcurrencyLimiterBuilder } from "./funnel.ts";

const FLEXIBLE_CREATED_PREFIX = "cache:flexible:created:";

/** Optional store name passed to `getName()`. */
export type CacheRepositoryOptions = {
  store?: string | null;
};

type Ttl = number | Date;

/** Plain default or callback invoked only on cache miss. */
export type CacheDefault<T> = T | (() => T | Promise<T>);

async function valueOrCallback<T>(
  defaultValue?: CacheDefault<T>,
): Promise<T | undefined> {
  if (defaultValue === undefined) return undefined;
  if (typeof defaultValue === "function") {
    return await (defaultValue as () => T | Promise<T>)();
  }
  return defaultValue;
}

/**
 * Cache repository (`Cache.get`, `remember`, …).
 */
export class CacheRepository {
  protected store: CacheStore;
  #name: string | null;
  #defaultCacheTime: number | null = null;
  readonly #flexibleRefreshing = new Set<string>();

  constructor(store: CacheStore, options: CacheRepositoryOptions = {}) {
    this.store = store;
    this.#name = options.store ?? null;
  }

  /** Underlying store (for drivers / tagged cache). */
  getStore(): CacheStore {
    return this.store;
  }

  /** Replace the underlying store. */
  setStore(store: CacheStore): this {
    this.store = store;
    return this;
  }

  /** Configured store name, if any. */
  getName(): string | null {
    return this.#name;
  }

  /** Whether this repository can use `tags()`. */
  supportsTags(): boolean {
    return true;
  }

  /** Default TTL in seconds (`null` means unset). */
  getDefaultCacheTime(): number | null {
    return this.#defaultCacheTime;
  }

  /** Set the default TTL in seconds. */
  setDefaultCacheTime(seconds: number | null): this {
    this.#defaultCacheTime = seconds;
    return this;
  }

  /**
   * Convert a TTL to whole seconds.
   * Dates are relative to now; non-positive results become `0`.
   */
  getSeconds(ttl: Ttl): number {
    if (ttl instanceof Date) {
      const seconds = Math.ceil((ttl.getTime() - Date.now()) / 1000);
      return seconds > 0 ? seconds : 0;
    }
    const n = Number(ttl);
    if (!Number.isFinite(n)) return 0;
    return n > 0 ? Math.trunc(n) : 0;
  }

  /** `Cache.tags([...])`. */
  tags(names: string | string[]): TaggedCache {
    const { TaggedCache: Tagged } = require("./tagged-cache.ts") as typeof import("./tagged-cache.ts");
    const tagged = new Tagged(
      this.store,
      Array.isArray(names) ? names : [names],
      { store: this.#name },
    );
    tagged.setDefaultCacheTime(this.#defaultCacheTime);
    return tagged;
  }

  /**
   * Retrieve a value. Optional second argument is a plain default or a
   * callback invoked only when the key is missing (result is not stored —
   * use `remember` / `rememberForever` to cache the callback).
   */
  async get<T = unknown>(
    key: string,
    defaultValue?: CacheDefault<T>,
  ): Promise<T | undefined> {
    const hit = await this.store.get<T>(key);
    if (hit !== undefined) {
      await dispatchCacheEvent(new CacheHit(key, hit, this.#name));
      return hit;
    }
    await dispatchCacheEvent(new CacheMissed(key, this.#name));
    return valueOrCallback(defaultValue);
  }

  /** Retrieve a string value (throws if the stored value is not a string). */
  async string(
    key: string,
    defaultValue?: CacheDefault<string>,
  ): Promise<string> {
    const value = await this.get(key, defaultValue);
    if (typeof value !== "string") {
      throw new TypeError(
        `Cache value for key [${key}] must be a string, ${typeof value} given.`,
      );
    }
    return value;
  }

  /** Retrieve an integer value (throws if not an integer). */
  async integer(
    key: string,
    defaultValue?: CacheDefault<number>,
  ): Promise<number> {
    const value = await this.get(key, defaultValue);
    if (typeof value === "number" && Number.isInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
      return Number.parseInt(value, 10);
    }
    throw new TypeError(
      `Cache value for key [${key}] must be an integer, ${typeof value} given.`,
    );
  }

  /** Retrieve a float value (throws if not numeric). */
  async float(
    key: string,
    defaultValue?: CacheDefault<number>,
  ): Promise<number> {
    const value = await this.get(key, defaultValue);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) {
      return Number.parseFloat(value);
    }
    throw new TypeError(
      `Cache value for key [${key}] must be a float, ${typeof value} given.`,
    );
  }

  /** Retrieve a boolean value (throws if not a boolean). */
  async boolean(
    key: string,
    defaultValue?: CacheDefault<boolean>,
  ): Promise<boolean> {
    const value = await this.get(key, defaultValue);
    if (typeof value !== "boolean") {
      throw new TypeError(
        `Cache value for key [${key}] must be a boolean, ${typeof value} given.`,
      );
    }
    return value;
  }

  /** Retrieve an array value (throws if not an array). */
  async array(
    key: string,
    defaultValue?: CacheDefault<unknown[]>,
  ): Promise<unknown[]> {
    const value = await this.get(key, defaultValue);
    if (!Array.isArray(value)) {
      throw new TypeError(
        `Cache value for key [${key}] must be an array, ${typeof value} given.`,
      );
    }
    return value;
  }

  async put(key: string, value: unknown, ttl?: Ttl): Promise<void> {
    const seconds = ttl === undefined ? undefined : this.getSeconds(ttl);
    await this.store.put(key, value, seconds);
    await dispatchCacheEvent(
      new KeyWritten(
        key,
        value,
        seconds === undefined ? null : seconds,
        this.#name,
      ),
    );
  }

  /** Alias of `put` (PSR-16). */
  async set(key: string, value: unknown, ttl?: Ttl): Promise<boolean> {
    await this.put(key, value, ttl);
    return true;
  }

  /**
   * Store only if the key is missing (`Cache.add`).
   * Returns true when the value was stored.
   * Prefers store-level `add` (SETNX / single-turn) when the driver exposes it —
   * critical for queue `WithoutOverlapping` locks.
   */
  async add(key: string, value: unknown, ttl?: Ttl): Promise<boolean> {
    const seconds = ttl === undefined ? undefined : this.getSeconds(ttl);
    const store = this.store as CacheStore & {
      add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
    };
    let stored: boolean;
    if (typeof store.add === "function") {
      stored = await store.add(key, value, seconds);
    } else if (await this.has(key)) {
      stored = false;
    } else {
      await this.store.put(key, value, seconds);
      stored = true;
    }
    if (stored) {
      await dispatchCacheEvent(
        new KeyWritten(
          key,
          value,
          seconds === undefined ? null : seconds,
          this.#name,
        ),
      );
    }
    return stored;
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.store.forever(key, value);
    await dispatchCacheEvent(new KeyWritten(key, value, null, this.#name));
  }

  async forget(key: string): Promise<boolean> {
    const ok = await this.store.forget(key);
    if (ok) await dispatchCacheEvent(new KeyForgotten(key, this.#name));
    return ok;
  }

  /** Alias of `forget` (PSR-16). */
  delete(key: string): Promise<boolean> {
    return this.forget(key);
  }

  async flush(): Promise<void> {
    await this.store.flush();
    await dispatchCacheEvent(new CacheFlushed(this.#name));
  }

  /** Alias of `flush` (PSR-16). */
  async clear(): Promise<boolean> {
    await this.flush();
    return true;
  }

  has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /** `Cache.missing`. */
  async missing(key: string): Promise<boolean> {
    return !(await this.has(key));
  }

  /**
   * Get a value and delete it (`Cache.pull`).
   */
  async pull<T = unknown>(
    key: string,
    defaultValue?: CacheDefault<T>,
  ): Promise<T | undefined> {
    const value = await this.get<T>(key, defaultValue);
    await this.forget(key);
    return value;
  }

  /** `Cache.increment`. */
  increment(key: string, value = 1): Promise<number> {
    return this.store.increment(key, value);
  }

  /** `Cache.decrement`. */
  decrement(key: string, value = 1): Promise<number> {
    return this.store.decrement(key, value);
  }

  /** `Cache.many` — map of key → value (missing keys are `undefined`). */
  async many<T = unknown>(
    keys: string[],
  ): Promise<Record<string, T | undefined>> {
    const out: Record<string, T | undefined> = {};
    await Promise.all(
      keys.map(async (key) => {
        out[key] = await this.get<T>(key);
      }),
    );
    return out;
  }

  /** PSR-16 alias of `many`, applying `defaultValue` for misses. */
  async getMultiple<T = unknown>(
    keys: Iterable<string>,
    defaultValue?: CacheDefault<T>,
  ): Promise<Record<string, T | undefined>> {
    const out: Record<string, T | undefined> = {};
    await Promise.all(
      [...keys].map(async (key) => {
        out[key] = await this.get<T>(key, defaultValue);
      }),
    );
    return out;
  }

  /** `Cache.putMany`. */
  async putMany(
    values: Record<string, unknown>,
    ttl?: Ttl,
  ): Promise<void> {
    await Promise.all(
      Object.entries(values).map(([key, value]) => this.put(key, value, ttl)),
    );
  }

  /** Store many items with no expiry. */
  async putManyForever(values: Record<string, unknown>): Promise<boolean> {
    await Promise.all(
      Object.entries(values).map(([key, value]) => this.forever(key, value)),
    );
    return true;
  }

  /** PSR-16 alias of `putMany`. */
  async setMultiple(
    values: Record<string, unknown>,
    ttl?: Ttl,
  ): Promise<boolean> {
    await this.putMany(values, ttl);
    return true;
  }

  /** PSR-16 multi-delete. */
  async deleteMultiple(keys: Iterable<string>): Promise<boolean> {
    let ok = true;
    for (const key of keys) {
      if (!(await this.forget(key))) ok = false;
    }
    return ok;
  }

  /** Refresh TTL for an existing key; forgets when TTL ≤ 0. */
  async touch(key: string, ttl: Ttl): Promise<boolean> {
    const seconds = this.getSeconds(ttl);
    if (seconds <= 0) return this.forget(key);
    const value = await this.get(key);
    if (value === undefined) return false;
    await this.put(key, value, seconds);
    return true;
  }

  /** Get or store the result of `callback`. */
  async remember<T>(
    key: string,
    ttl: Ttl,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await callback();
    await this.put(key, value, ttl);
    return value;
  }

  /**
   * Like `remember`, but returns `[value, wasWarm]` where `wasWarm` is true
   * when the value was already cached.
   */
  async rememberWithWarmth<T>(
    key: string,
    ttl: Ttl,
    callback: () => T | Promise<T>,
  ): Promise<[T, boolean]> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return [hit, true];
    const value = await callback();
    await this.put(key, value, ttl);
    return [value, false];
  }

  async rememberForever<T>(
    key: string,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await callback();
    await this.forever(key, value);
    return value;
  }

  /** Alias of `rememberForever`. */
  sear<T>(key: string, callback: () => T | Promise<T>): Promise<T> {
    return this.rememberForever(key, callback);
  }

  /**
   * Stale-while-revalidate: `ttl[0]` is the fresh window (seconds), `ttl[1]`
   * is the total lifetime. During the stale window the cached value is
   * returned immediately while a background refresh runs.
   */
  async flexible<T>(
    key: string,
    ttl: [Ttl, Ttl],
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const createdKey = `${FLEXIBLE_CREATED_PREFIX}${key}`;
    const rows = await this.many<unknown>([key, createdKey]);
    const value = rows[key];
    const created = rows[createdKey];

    if (value === undefined || created === undefined) {
      const fresh = await callback();
      await this.putMany(
        {
          [key]: fresh,
          [createdKey]: Math.floor(Date.now() / 1000),
        },
        this.getSeconds(ttl[1]),
      );
      return fresh;
    }

    const createdAt = Number(created);
    if (createdAt + this.getSeconds(ttl[0]) > Math.floor(Date.now() / 1000)) {
      return value as T;
    }

    if (!this.#flexibleRefreshing.has(key)) {
      this.#flexibleRefreshing.add(key);
      void (async () => {
        try {
          const still = await this.get<number>(createdKey);
          if (still !== createdAt) return;
          const fresh = await callback();
          await this.putMany(
            {
              [key]: fresh,
              [createdKey]: Math.floor(Date.now() / 1000),
            },
            this.getSeconds(ttl[1]),
          );
        } finally {
          this.#flexibleRefreshing.delete(key);
        }
      })();
    }

    return value as T;
  }

  /** `Cache::lock($name, $seconds)`. */
  lock(name: string, seconds = 0, owner?: string): CacheLock {
    const lock = new CacheLock(this.store, name, seconds, owner);
    knownLockKeys.add(lockKey(name));
    return lock;
  }

  /** Concurrency limiter (`Cache.funnel('job').limit(3).block(10).then(...)`). */
  funnel(name: string): ConcurrencyLimiterBuilder {
    return new ConcurrencyLimiterBuilder(this, name);
  }

  /** Forget every lock key this process has created via `lock()`. */
  async flushLocks(): Promise<void> {
    await Promise.all([...knownLockKeys].map((key) => this.forget(key)));
    knownLockKeys.clear();
  }
}

const knownLockKeys = new Set<string>();

function lockKey(name: string): string {
  return name.startsWith(CACHE_LOCK_PREFIX) ? name : `${CACHE_LOCK_PREFIX}${name}`;
}

let defaultCache: CacheRepository | undefined;
let previousCache: CacheRepository | undefined;
let activeFake: CacheFake | undefined;
const namedStores = new Map<string, CacheRepository>();
const namedStoreFactories = new Map<string, () => CacheRepository>();
const memoizedRepositories = new Map<string, CacheRepository>();

export function setCache(repository: CacheRepository): void {
  defaultCache = repository;
}

function fakeCache(): CacheFake {
  previousCache = defaultCache;
  const fake = new CacheFake();
  activeFake = fake;
  setCache(new CacheRepository(fake));
  return fake;
}

function restoreCache(): void {
  flushMemoizedCaches();
  if (previousCache) setCache(previousCache);
  previousCache = undefined;
  activeFake = undefined;
}

function requireCacheFake(): CacheFake {
  if (!activeFake) {
    throw new Error("Call Cache.fake() before asserting cache keys.");
  }
  return activeFake;
}


function resolveNamedStore(name: string | null | undefined): CacheRepository {
  if (name == null || name === "" || name === "default") {
    if (!defaultCache) {
      throw new Error("No default cache repository. Call setCache() first.");
    }
    return defaultCache;
  }
  // The default store answers to its own name, even if an older store was registered under it.
  if (defaultCache?.getName() === name) return defaultCache;
  const hit = namedStores.get(name);
  if (hit) return hit;
  const factory = namedStoreFactories.get(name);
  if (factory) {
    const repo = factory();
    namedStores.set(name, repo);
    return repo;
  }
  throw new Error(`Cache store [${name}] is not configured.`);
}

/**
 * Register a named cache store (`Cache::store` / `memo($store)`).
 */
export function setCacheStore(name: string, repository: CacheRepository): void {
  namedStores.set(name, repository);
  namedStoreFactories.delete(name);
}

/**
 * Register a lazy named store factory (built on first `Cache.store(name)`).
 */
export function setCacheStoreFactory(
  name: string,
  factory: () => CacheRepository,
): void {
  namedStoreFactories.set(name, factory);
  namedStores.delete(name);
}

/** Drop memoized repositories (end of request/job, or tests). */
export function flushMemoizedCaches(): void {
  for (const repo of memoizedRepositories.values()) {
    const store = repo.getStore();
    if (store instanceof MemoizedStore) store.forgetMemoized();
  }
  memoizedRepositories.clear();
}

/** `cache()` helper — returns the default repository. */
export function cache(): CacheRepository {
  return defaultCache!;
}

/** `Cache` facade. */
export const Cache = {
  get<T = unknown>(
    key: string,
    defaultValue?: CacheDefault<T>,
  ): Promise<T | undefined> {
    return defaultCache!.get<T>(key, defaultValue);
  },
  string(
    key: string,
    defaultValue?: CacheDefault<string>,
  ): Promise<string> {
    return defaultCache!.string(key, defaultValue);
  },
  integer(
    key: string,
    defaultValue?: CacheDefault<number>,
  ): Promise<number> {
    return defaultCache!.integer(key, defaultValue);
  },
  float(
    key: string,
    defaultValue?: CacheDefault<number>,
  ): Promise<number> {
    return defaultCache!.float(key, defaultValue);
  },
  boolean(
    key: string,
    defaultValue?: CacheDefault<boolean>,
  ): Promise<boolean> {
    return defaultCache!.boolean(key, defaultValue);
  },
  array(
    key: string,
    defaultValue?: CacheDefault<unknown[]>,
  ): Promise<unknown[]> {
    return defaultCache!.array(key, defaultValue);
  },
  put(key: string, value: unknown, ttl?: Ttl): Promise<void> {
    return defaultCache!.put(key, value, ttl);
  },
  set(key: string, value: unknown, ttl?: Ttl): Promise<boolean> {
    return defaultCache!.set(key, value, ttl);
  },
  add(key: string, value: unknown, ttl?: Ttl): Promise<boolean> {
    return defaultCache!.add(key, value, ttl);
  },
  forever(key: string, value: unknown): Promise<void> {
    return defaultCache!.forever(key, value);
  },
  forget(key: string): Promise<boolean> {
    return defaultCache!.forget(key);
  },
  delete(key: string): Promise<boolean> {
    return defaultCache!.delete(key);
  },
  flush(): Promise<void> {
    return defaultCache!.flush();
  },
  clear(): Promise<boolean> {
    return defaultCache!.clear();
  },
  has(key: string): Promise<boolean> {
    return defaultCache!.has(key);
  },
  missing(key: string): Promise<boolean> {
    return defaultCache!.missing(key);
  },
  pull<T = unknown>(
    key: string,
    defaultValue?: CacheDefault<T>,
  ): Promise<T | undefined> {
    return defaultCache!.pull<T>(key, defaultValue);
  },
  increment(key: string, value = 1): Promise<number> {
    return defaultCache!.increment(key, value);
  },
  decrement(key: string, value = 1): Promise<number> {
    return defaultCache!.decrement(key, value);
  },
  many<T = unknown>(keys: string[]): Promise<Record<string, T | undefined>> {
    return defaultCache!.many<T>(keys);
  },
  getMultiple<T = unknown>(
    keys: Iterable<string>,
    defaultValue?: CacheDefault<T>,
  ): Promise<Record<string, T | undefined>> {
    return defaultCache!.getMultiple<T>(keys, defaultValue);
  },
  putMany(
    values: Record<string, unknown>,
    ttl?: Ttl,
  ): Promise<void> {
    return defaultCache!.putMany(values, ttl);
  },
  putManyForever(values: Record<string, unknown>): Promise<boolean> {
    return defaultCache!.putManyForever(values);
  },
  setMultiple(
    values: Record<string, unknown>,
    ttl?: Ttl,
  ): Promise<boolean> {
    return defaultCache!.setMultiple(values, ttl);
  },
  deleteMultiple(keys: Iterable<string>): Promise<boolean> {
    return defaultCache!.deleteMultiple(keys);
  },
  touch(key: string, ttl: Ttl): Promise<boolean> {
    return defaultCache!.touch(key, ttl);
  },
  remember<T>(
    key: string,
    ttl: Ttl,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return defaultCache!.remember(key, ttl, callback);
  },
  rememberWithWarmth<T>(
    key: string,
    ttl: Ttl,
    callback: () => T | Promise<T>,
  ): Promise<[T, boolean]> {
    return defaultCache!.rememberWithWarmth(key, ttl, callback);
  },
  rememberForever<T>(
    key: string,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return defaultCache!.rememberForever(key, callback);
  },
  sear<T>(key: string, callback: () => T | Promise<T>): Promise<T> {
    return defaultCache!.sear(key, callback);
  },
  flexible<T>(
    key: string,
    ttl: [Ttl, Ttl],
    callback: () => T | Promise<T>,
  ): Promise<T> {
    return defaultCache!.flexible(key, ttl, callback);
  },
  getDefaultCacheTime(): number | null {
    return defaultCache!.getDefaultCacheTime();
  },
  setDefaultCacheTime(seconds: number | null): CacheRepository {
    return defaultCache!.setDefaultCacheTime(seconds);
  },
  getSeconds(ttl: Ttl): number {
    return defaultCache!.getSeconds(ttl);
  },
  getName(): string | null {
    return defaultCache!.getName();
  },
  setStore(store: CacheStore): CacheRepository {
    return defaultCache!.setStore(store);
  },
  getStore(): CacheStore {
    return defaultCache!.getStore();
  },
  supportsTags(): boolean {
    return defaultCache!.supportsTags();
  },
  tags(names: string | string[]): TaggedCache {
    return defaultCache!.tags(names);
  },
  lock(name: string, seconds = 0, owner?: string): CacheLock {
    return defaultCache!.lock(name, seconds, owner);
  },
  funnel(name: string): ConcurrencyLimiterBuilder {
    return defaultCache!.funnel(name);
  },
  flushLocks(): Promise<void> {
    return defaultCache!.flushLocks();
  },
  /** Resolve a named store (or the default). */
  store(name?: string | null): CacheRepository {
    return resolveNamedStore(name);
  },
  /**
   * `Cache::memo([$store])` — request/job-scoped in-memory memo over a store.
   */
  memo(store?: string | null): CacheRepository {
    const key = store ?? defaultCache?.getName() ?? "default";
    let memoized = memoizedRepositories.get(key);
    if (!memoized) {
      const underlying = resolveNamedStore(store);
      memoized = new CacheRepository(
        new MemoizedStore(underlying.getStore()),
        { store: key === "default" ? underlying.getName() : key },
      );
      memoized.setDefaultCacheTime(underlying.getDefaultCacheTime());
      memoizedRepositories.set(key, memoized);
    }
    return memoized;
  },
  /** Clear memoized cache instances (tests / end of request). */
  flushMemo(): void {
    flushMemoizedCaches();
  },
  fake(): CacheFake {
    return fakeCache();
  },
  assertHas(key: string): Promise<void> {
    return requireCacheFake().assertHas(key);
  },
  assertMissing(key: string): Promise<void> {
    return requireCacheFake().assertMissing(key);
  },
  assertHasValue(key: string, value: unknown): Promise<void> {
    return requireCacheFake().assertHasValue(key, value);
  },
  restore(): void {
    restoreCache();
  },
};
