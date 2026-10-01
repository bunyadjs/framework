import type { CacheStore } from "@bunyad/contracts";

/**
 * Tries each configured store in order. The first store that succeeds for a
 * write/read wins; later stores are used only when an earlier one throws.
 */
export class FailoverCacheStore implements CacheStore {
  constructor(private readonly stores: CacheStore[]) {
    if (stores.length === 0) {
      throw new Error("FailoverCacheStore requires at least one store.");
    }
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.#first((store) => store.get<T>(key));
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    await this.#first((store) => store.put(key, value, seconds));
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.#first((store) => store.forever(key, value));
  }

  async forget(key: string): Promise<boolean> {
    return this.#first((store) => store.forget(key));
  }

  async flush(): Promise<void> {
    await this.#first((store) => store.flush());
  }

  async has(key: string): Promise<boolean> {
    return this.#first((store) => store.has(key));
  }

  async increment(key: string, value = 1): Promise<number> {
    return this.#first((store) => store.increment(key, value));
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.#first((store) => store.decrement(key, value));
  }

  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    return this.#first(async (store) => {
      const withAdd = store as CacheStore & {
        add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
      };
      if (typeof withAdd.add === "function") {
        return withAdd.add(key, value, seconds);
      }
      if (await store.has(key)) return false;
      await store.put(key, value, seconds);
      return true;
    });
  }

  async #first<T>(fn: (store: CacheStore) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const store of this.stores) {
      try {
        return await fn(store);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "All failover cache stores failed."));
  }
}
