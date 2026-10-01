import type { CacheStore } from "@bunyad/contracts";
import {
  CacheRepository,
  type CacheDefault,
  type CacheRepositoryOptions,
} from "./repository.ts";

/**
 * `Cache.tags([...])` — store/read under a tag namespace and
 * flush all keys associated with those tags.
 */
export class TaggedCache extends CacheRepository {
  readonly #names: string[];

  constructor(
    store: CacheStore,
    names: string[],
    options: CacheRepositoryOptions = {},
  ) {
    super(store, options);
    this.#names = [...new Set(names)].sort();
  }

  /** Tag names bound to this instance. */
  getTags(): string[] {
    return [...this.#names];
  }

  override supportsTags(): boolean {
    return true;
  }

  #itemKey(key: string): string {
    return `tagged:${this.#names.join("|")}:${key}`;
  }

  #tagListKey(tag: string): string {
    return `__cache_tag__:${tag}`;
  }

  async #track(fullKey: string): Promise<void> {
    for (const tag of this.#names) {
      const listKey = this.#tagListKey(tag);
      const list = (await this.store.get<string[]>(listKey)) ?? [];
      if (!list.includes(fullKey)) {
        list.push(fullKey);
        await this.store.forever(listKey, list);
      }
    }
  }

  async #untrack(fullKey: string): Promise<void> {
    for (const tag of this.#names) {
      const listKey = this.#tagListKey(tag);
      const list = (await this.store.get<string[]>(listKey)) ?? [];
      const next = list.filter((k) => k !== fullKey);
      if (next.length === 0) await this.store.forget(listKey);
      else await this.store.forever(listKey, next);
    }
  }

  override async get<T = unknown>(
    key: string,
    defaultValue?: CacheDefault<T>,
  ): Promise<T | undefined> {
    const hit = await this.store.get<T>(this.#itemKey(key));
    if (hit !== undefined) return hit;
    if (defaultValue === undefined) return undefined;
    if (typeof defaultValue === "function") {
      return await (defaultValue as () => T | Promise<T>)();
    }
    return defaultValue;
  }

  override async put(
    key: string,
    value: unknown,
    seconds?: number,
  ): Promise<void> {
    const full = this.#itemKey(key);
    await this.store.put(full, value, seconds);
    await this.#track(full);
  }

  override async forever(key: string, value: unknown): Promise<void> {
    const full = this.#itemKey(key);
    await this.store.forever(full, value);
    await this.#track(full);
  }

  override async add(
    key: string,
    value: unknown,
    seconds?: number,
  ): Promise<boolean> {
    const full = this.#itemKey(key);
    const store = this.store as CacheStore & {
      add?: (key: string, value: unknown, seconds?: number) => Promise<boolean>;
    };
    if (typeof store.add === "function") {
      const ok = await store.add(full, value, seconds);
      if (ok) await this.#track(full);
      return ok;
    }
    if (await this.has(key)) return false;
    await this.put(key, value, seconds);
    return true;
  }

  override async forget(key: string): Promise<boolean> {
    const full = this.#itemKey(key);
    const ok = await this.store.forget(full);
    if (ok) await this.#untrack(full);
    return ok;
  }

  override async flush(): Promise<void> {
    const seen = new Set<string>();
    for (const tag of this.#names) {
      const listKey = this.#tagListKey(tag);
      const list = (await this.store.get<string[]>(listKey)) ?? [];
      for (const k of list) seen.add(k);
      await this.store.forget(listKey);
    }
    for (const k of seen) await this.store.forget(k);
  }

  override has(key: string): Promise<boolean> {
    return this.store.has(this.#itemKey(key));
  }

  override async increment(key: string, value = 1): Promise<number> {
    const full = this.#itemKey(key);
    const next = await this.store.increment(full, value);
    await this.#track(full);
    return next;
  }

  override async decrement(key: string, value = 1): Promise<number> {
    const full = this.#itemKey(key);
    const next = await this.store.decrement(full, value);
    await this.#track(full);
    return next;
  }
}
