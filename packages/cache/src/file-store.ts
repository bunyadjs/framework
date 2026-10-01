import type { CacheStore } from "@bunyad/contracts";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { counterBase } from "./counter.ts";

export type FileCacheStoreOptions = {
  path: string;
};

type Entry = { value: unknown; expiresAt?: number };

/**
 * File cache driver — one JSON file per key.
 */
export class FileCacheStore implements CacheStore {
  readonly #path: string;
  #ready: Promise<void>;

  constructor(options: FileCacheStoreOptions) {
    this.#path = options.path;
    this.#ready = mkdir(this.#path, { recursive: true }).then(() => undefined);
  }

  #file(key: string): string {
    const safe = key.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.#path, `${safe}.json`);
  }

  async #readEntry(key: string): Promise<Entry | undefined> {
    await this.#ready;
    const file = Bun.file(this.#file(key));
    if (!(await file.exists())) return undefined;
    const row = (await file.json()) as Entry;
    if (row.expiresAt !== undefined && Date.now() >= row.expiresAt) {
      await this.forget(key);
      return undefined;
    }
    return row;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.#readEntry(key);
    return row ? (row.value as T) : undefined;
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    await this.#ready;
    const entry: Entry = {
      value,
      expiresAt: seconds !== undefined ? Date.now() + seconds * 1000 : undefined,
    };
    await Bun.write(this.#file(key), JSON.stringify(entry));
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.put(key, value);
  }

  /** SET-if-absent for `Cache.add`. */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if ((await this.#readEntry(key)) !== undefined) return false;
    await this.put(key, value, seconds);
    return true;
  }

  async forget(key: string): Promise<boolean> {
    await this.#ready;
    const file = this.#file(key);
    if (!(await Bun.file(file).exists())) return false;
    await unlink(file);
    return true;
  }

  async flush(): Promise<void> {
    await this.#ready;
    const glob = new Bun.Glob("*.json");
    for await (const name of glob.scan({ cwd: this.#path })) {
      await unlink(join(this.#path, name));
    }
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async increment(key: string, value = 1): Promise<number> {
    const row = await this.#readEntry(key);
    const next = counterBase(row?.value) + value;
    await this.#ready;
    await Bun.write(
      this.#file(key),
      JSON.stringify({
        value: next,
        expiresAt: row?.expiresAt,
      } satisfies Entry),
    );
    return next;
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.increment(key, -value);
  }
}
