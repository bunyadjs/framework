import type { VersionStore } from "./types.ts";

/** Single-process counters. Use a cache-backed store when more than one process serves the app. */
export class MemoryVersionStore implements VersionStore {
  #counters = new Map<string, number>();

  async get(keys: string[]): Promise<number[]> {
    return keys.map((key) => this.#counters.get(key) ?? 0);
  }

  async bump(key: string): Promise<number> {
    const next = (this.#counters.get(key) ?? 0) + 1;
    this.#counters.set(key, next);
    return next;
  }
}

/** Counters in a shared cache (atomic `increment`), so every process sees every change. */
export type CounterCache = {
  get(key: string): Promise<unknown> | unknown;
  increment(key: string, value?: number): Promise<number | boolean | void> | number | boolean | void;
};

export class CacheVersionStore implements VersionStore {
  constructor(
    private readonly cache: CounterCache,
    private readonly prefix = "perm:v:",
  ) {}

  async get(keys: string[]): Promise<number[]> {
    const values = await Promise.all(keys.map((key) => this.cache.get(this.prefix + key)));
    return values.map((value) => Number(value ?? 0) || 0);
  }

  async bump(key: string): Promise<number> {
    const result = await this.cache.increment(this.prefix + key, 1);
    if (typeof result === "number") return result;
    return Number(await this.cache.get(this.prefix + key)) || 0;
  }
}
