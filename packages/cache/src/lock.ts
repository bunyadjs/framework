import type { CacheStore } from "@bunyad/contracts";

export type LockOwner = string;

function randomOwner(): string {
  return crypto.randomUUID();
}

/**
 * Atomic lock backed by `Cache.add` (SETNX-style).
 * Laravel `Cache::lock($name, $seconds)`.
 */
export class CacheLock {
  readonly #store: CacheStore & {
    add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
  };
  readonly #key: string;
  readonly #seconds: number;
  readonly #owner: string;
  #acquired = false;

  constructor(
    store: CacheStore & {
      add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
    },
    name: string,
    seconds = 0,
    owner?: string,
  ) {
    this.#store = store;
    this.#key = name.startsWith("bunyad:lock:")
      ? name
      : `bunyad:lock:${name}`;
    this.#seconds = seconds;
    this.#owner = owner ?? randomOwner();
  }

  owner(): string {
    return this.#owner;
  }

  /**
   * Try to acquire. Without a callback, returns whether the lock was taken.
   * With a callback, runs it while held and releases afterward; returns the callback result (or false if not acquired).
   */
  async get<T = unknown>(
    callback?: () => T | Promise<T>,
  ): Promise<boolean | T> {
    const acquired = await this.#acquire();
    if (!callback) return acquired;
    if (!acquired) return false as boolean;
    try {
      return await callback();
    } finally {
      await this.release();
    }
  }

  /**
   * Block until the lock is acquired or `seconds` elapses.
   * Throws when the wait times out.
   */
  async block<T = unknown>(
    seconds: number,
    callback?: () => T | Promise<T>,
  ): Promise<T | boolean> {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      const acquired = await this.#acquire();
      if (acquired) {
        if (!callback) return true;
        try {
          return await callback();
        } finally {
          await this.release();
        }
      }
      await Bun.sleep(50);
    }
    throw new Error(
      `Unable to acquire lock [${this.#key}] within ${seconds} seconds.`,
    );
  }

  async release(): Promise<boolean> {
    if (!this.#acquired) return false;
    const current = await this.#store.get<string>(this.#key);
    if (current !== this.#owner) {
      this.#acquired = false;
      return false;
    }
    await this.#store.forget(this.#key);
    this.#acquired = false;
    return true;
  }

  /** Release without checking owner. */
  async forceRelease(): Promise<void> {
    await this.#store.forget(this.#key);
    this.#acquired = false;
  }

  async #acquire(): Promise<boolean> {
    const ttl = this.#seconds > 0 ? this.#seconds : undefined;
    let ok: boolean;
    if (typeof this.#store.add === "function") {
      ok = await this.#store.add(this.#key, this.#owner, ttl);
    } else if (await this.#store.has(this.#key)) {
      ok = false;
    } else {
      if (ttl !== undefined) {
        await this.#store.put(this.#key, this.#owner, ttl);
      } else {
        await this.#store.forever(this.#key, this.#owner);
      }
      ok = true;
    }
    if (ok) this.#acquired = true;
    return ok;
  }
}

/** Prefix used by `Cache.lock` / `flushLocks`. */
export const CACHE_LOCK_PREFIX = "bunyad:lock:";
