import type { CacheStore } from "@bunyad/contracts";
import { counterBase } from "./counter.ts";

/** Minimal DB surface — satisfied by `@bunyad/database` Connection. */
export type CacheConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[] | Promise<T[]>;
};

export type DatabaseCacheStoreOptions = {
  connection: CacheConnection;
  /** Table name (Laravel default `cache`). */
  table?: string;
  /** Key prefix. */
  prefix?: string;
};

type CacheRow = {
  key: string;
  value: string;
  expiration: number;
};

function assertTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid cache table name [${table}].`);
  }
  return table;
}

/**
 * Laravel `database` cache driver — JSON values in a `cache` table.
 *
 * Expected schema (Laravel-compatible subset):
 * ```sql
 * CREATE TABLE cache (
 *   key TEXT PRIMARY KEY,
 *   value TEXT NOT NULL,
 *   expiration INTEGER NOT NULL
 * );
 * ```
 */
export class DatabaseCacheStore implements CacheStore {
  readonly #db: CacheConnection;
  readonly #table: string;
  readonly #prefix: string;

  constructor(options: DatabaseCacheStoreOptions) {
    this.#db = options.connection;
    this.#table = assertTable(options.table ?? "cache");
    this.#prefix = options.prefix ?? "";
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  async #readRow(key: string): Promise<CacheRow | undefined> {
    const row = await this.#db.get<CacheRow>(
      `SELECT key, value, expiration FROM ${this.#table} WHERE key = ?`,
      [this.#key(key)],
    );
    if (!row) return undefined;
    const now = Math.floor(Date.now() / 1000);
    if (Number(row.expiration) !== 0 && Number(row.expiration) <= now) {
      await this.forget(key);
      return undefined;
    }
    return row;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.#readRow(key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {
    const k = this.#key(key);
    const payload = JSON.stringify(value);
    const expiration =
      seconds === undefined
        ? 0
        : Math.floor(Date.now() / 1000) + Math.max(0, seconds);

    const existing = await this.#db.get<{ key: string }>(
      `SELECT key FROM ${this.#table} WHERE key = ?`,
      [k],
    );
    if (existing) {
      await this.#db.run(
        `UPDATE ${this.#table} SET value = ?, expiration = ? WHERE key = ?`,
        [payload, expiration, k],
      );
    } else {
      await this.#db.run(
        `INSERT INTO ${this.#table} (key, value, expiration) VALUES (?, ?, ?)`,
        [k, payload, expiration],
      );
    }
  }

  async forever(key: string, value: unknown): Promise<void> {
    await this.put(key, value);
  }

  /** SET-if-absent for `Cache.add` (insert-only when missing). */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    if ((await this.#readRow(key)) !== undefined) return false;
    const k = this.#key(key);
    const payload = JSON.stringify(value);
    const expiration =
      seconds === undefined
        ? 0
        : Math.floor(Date.now() / 1000) + Math.max(0, seconds);
    await this.#db.run(
      `INSERT INTO ${this.#table} (key, value, expiration) VALUES (?, ?, ?)`,
      [k, payload, expiration],
    );
    return true;
  }

  async forget(key: string): Promise<boolean> {
    const before = await this.#db.get<{ key: string }>(
      `SELECT key FROM ${this.#table} WHERE key = ?`,
      [this.#key(key)],
    );
    if (!before) return false;
    await this.#db.run(`DELETE FROM ${this.#table} WHERE key = ?`, [
      this.#key(key),
    ]);
    return true;
  }

  async flush(): Promise<void> {
    if (this.#prefix) {
      await this.#db.run(`DELETE FROM ${this.#table} WHERE key LIKE ?`, [
        `${this.#prefix}%`,
      ]);
      return;
    }
    await this.#db.run(`DELETE FROM ${this.#table}`);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async increment(key: string, value = 1): Promise<number> {
    const row = await this.#readRow(key);
    let current: unknown;
    if (row) {
      try {
        current = JSON.parse(row.value);
      } catch {
        current = undefined;
      }
    }
    const next = counterBase(current) + value;
    const payload = JSON.stringify(next);
    const k = this.#key(key);
    if (row) {
      await this.#db.run(
        `UPDATE ${this.#table} SET value = ? WHERE key = ?`,
        [payload, k],
      );
    } else {
      await this.#db.run(
        `INSERT INTO ${this.#table} (key, value, expiration) VALUES (?, ?, ?)`,
        [k, payload, 0],
      );
    }
    return next;
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.increment(key, -value);
  }
}
