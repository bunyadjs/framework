import type { CacheStore } from "@bunyad/contracts";
import { counterBase } from "./counter.ts";

type Entry = { value: unknown; expiresAt?: number };

/**
 * In-memory cache store — tests and single-process apps.
 */
export class MemoryCacheStore implements CacheStore {
  readonly #data = new Map<string, Entry>();

  #read(key: string): Entry | undefined {
    const row = this.#data.get(key);
    if (!row) return undefined;
    if (row.expiresAt !== undefined && Date.now() >= row.expiresAt) {
      this.#data.delete(key);
      return undefined;
    }
    return row;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = this.#read(key);
    return row ? (row.value as T) : undefined;
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    this.#data.set(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    });
  }

  async forever(key: string, value: unknown): Promise<void> {
    this.#data.set(key, { value });
  }

  /** SET-if-absent (single-turn; used by `Cache.add` / queue locks). */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if (this.#read(key) !== undefined) return false;
    this.#data.set(key, {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    });
    return true;
  }

  async forget(key: string): Promise<boolean> {
    return this.#data.delete(key);
  }

  async flush(): Promise<void> {
    this.#data.clear();
  }

  async has(key: string): Promise<boolean> {
    return this.#read(key) !== undefined;
  }

  async increment(key: string, value = 1): Promise<number> {
    const row = this.#read(key);
    const next = counterBase(row?.value) + value;
    if (row) row.value = next;
    else this.#data.set(key, { value: next });
    return next;
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.increment(key, -value);
  }
}
