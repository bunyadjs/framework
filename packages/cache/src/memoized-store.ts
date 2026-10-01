import type { CacheStore } from "@bunyad/contracts";

/**
 * Laravel `MemoizedStore` — decorate a CacheStore with per-execution in-memory hits.
 * Mutating ops invalidate the memoized key (or flush all) then delegate.
 */
export class MemoizedStore implements CacheStore {
  readonly #memo = new Map<string, unknown>();
  readonly #underlying: CacheStore;

  constructor(underlying: CacheStore) {
    this.#underlying = underlying;
  }

  /** Underlying store being decorated. */
  getRepository(): CacheStore {
    return this.#underlying;
  }

  /** Drop all memoized values (does not flush the underlying store). */
  forgetMemoized(): void {
    this.#memo.clear();
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    if (this.#memo.has(key)) {
      return this.#memo.get(key) as T | undefined;
    }
    const value = await this.#underlying.get<T>(key);
    this.#memo.set(key, value);
    return value;
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    this.#memo.delete(key);
    return this.#underlying.put(key, value, seconds);
  }

  async forever(key: string, value: unknown): Promise<void> {
    this.#memo.delete(key);
    return this.#underlying.forever(key, value);
  }

  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    this.#memo.delete(key);
    const underlying = this.#underlying as CacheStore & {
      add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
    };
    if (typeof underlying.add === "function") {
      return underlying.add(key, value, seconds);
    }
    if ((await this.#underlying.has(key))) return false;
    await this.#underlying.put(key, value, seconds);
    return true;
  }

  async forget(key: string): Promise<boolean> {
    this.#memo.delete(key);
    return this.#underlying.forget(key);
  }

  async flush(): Promise<void> {
    this.#memo.clear();
    return this.#underlying.flush();
  }

  async has(key: string): Promise<boolean> {
    if (this.#memo.has(key)) {
      return this.#memo.get(key) !== undefined;
    }
    const value = await this.#underlying.get(key);
    this.#memo.set(key, value);
    return value !== undefined;
  }

  async increment(key: string, value = 1): Promise<number> {
    this.#memo.delete(key);
    return this.#underlying.increment(key, value);
  }

  async decrement(key: string, value = 1): Promise<number> {
    this.#memo.delete(key);
    return this.#underlying.decrement(key, value);
  }
}
