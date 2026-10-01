import { RedisClient } from "bun";
import type { CacheStore } from "@bunyad/contracts";
import { counterBase } from "./counter.ts";

export type RedisCacheStoreOptions = {
  /** Redis URL, e.g. `redis://127.0.0.1:6379`. */
  url?: string;
  /** Key prefix (Laravel `cache` prefix). */
  prefix?: string;
  /** Inject a client (tests / custom). */
  client?: RedisClient;
};

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  /** SET key value NX — returns 1 when set, 0 when key exists. */
  setnx?(key: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ttl?(key: string): Promise<number>;
  close(): void;
};

/**
 * Redis cache driver via Bun's `RedisClient`.
 */
export class RedisCacheStore implements CacheStore {
  readonly #prefix: string;
  readonly #client: RedisLike;
  readonly #ownsClient: boolean;

  constructor(options: RedisCacheStoreOptions = {}) {
    this.#prefix = options.prefix ?? "bunyad:";
    if (options.client) {
      this.#client = options.client as unknown as RedisLike;
      this.#ownsClient = false;
    } else {
      this.#client = new RedisClient(options.url) as unknown as RedisLike;
      this.#ownsClient = true;
    }
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = await this.#client.get(this.#key(key));
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    const k = this.#key(key);
    const payload = JSON.stringify(value);
    await this.#client.set(k, payload);
    if (seconds !== undefined) {
      await this.#client.expire(k, seconds);
    }
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.put(key, value);
  }

  /** SET-if-absent via Redis SETNX (+ EXPIRE). */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    const k = this.#key(key);
    const payload = JSON.stringify(value);
    if (this.#client.setnx) {
      const ok = await this.#client.setnx(k, payload);
      if (!ok) return false;
      if (seconds !== undefined) await this.#client.expire(k, seconds);
      return true;
    }
    if ((await this.#client.exists(k)) > 0) return false;
    await this.put(key, value, seconds);
    return true;
  }

  async forget(key: string): Promise<boolean> {
    return (await this.#client.del(this.#key(key))) > 0;
  }

  async flush(): Promise<void> {
    const keys = await this.#client.keys(`${this.#prefix}*`);
    if (keys.length > 0) await this.#client.del(...keys);
  }

  async has(key: string): Promise<boolean> {
    return (await this.#client.exists(this.#key(key))) > 0;
  }

  async increment(key: string, value = 1): Promise<number> {
    const k = this.#key(key);
    const raw = await this.#client.get(k);
    let current: unknown;
    if (raw != null) {
      try {
        current = JSON.parse(raw);
      } catch {
        current = Number(raw);
      }
    }
    const next = counterBase(current) + value;
    const ttl =
      raw != null && this.#client.ttl ? await this.#client.ttl(k) : -1;
    await this.#client.set(k, JSON.stringify(next));
    if (ttl > 0) await this.#client.expire(k, ttl);
    return next;
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.increment(key, -value);
  }

  close(): void {
    if (this.#ownsClient) this.#client.close();
  }
}
