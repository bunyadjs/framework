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
  /** Table name (default `cache`). */
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
 * `database` cache driver — JSON values in a `cache` table.
 *
 * Expected schema:
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

  /**
   * SET-if-absent for `Cache.add`, in one statement: insert the row, or take over a row that has
   * expired. Of several callers adding together, the database lets exactly one through.
   */
  async add(key: string, value: unknown, seconds?: number): Promise<boolean> {
    const k = this.#key(key);
    const payload = JSON.stringify(value);
    const now = Math.floor(Date.now() / 1000);
    const expiration = seconds === undefined ? 0 : now + Math.max(0, seconds);
    const written = await this.#db.get<{ key: string }>(
      `INSERT INTO ${this.#table} (key, value, expiration) VALUES (?, ?, ?) ` +
        `ON CONFLICT (key) DO UPDATE SET value = excluded.value, expiration = excluded.expiration ` +
        `WHERE ${this.#table}.expiration <> 0 AND ${this.#table}.expiration <= ? RETURNING key`,
      [k, payload, expiration, now],
    );
    return written != null;
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

  /**
   * Add to a counter without losing a concurrent add. A whole-number counter is changed by the
   * database in one statement (`SET value = value + n`), which keeps its expiry. A new key is
   * inserted only if nobody beat us to it, and a value that is not a whole number (a decimal, an
   * object) is swapped only if it is still what we read.
   */
  async increment(key: string, value = 1): Promise<number> {
    const k = this.#key(key);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const now = Math.floor(Date.now() / 1000);
      if (Number.isInteger(value)) {
        try {
          const changed = await this.#db.get<{ value: string }>(
            `UPDATE ${this.#table} SET value = CAST(CAST(value AS BIGINT) + CAST(? AS BIGINT) AS TEXT) ` +
              `WHERE key = ? AND (expiration = 0 OR expiration > ?) ` +
              `AND value = CAST(CAST(value AS BIGINT) AS TEXT) RETURNING value`,
            [value, k, now],
          );
          if (changed) return Number(changed.value);
        } catch {
          // a stored value that cannot be read as a whole number: handled below
        }
      }

      const row = await this.#readRow(key);
      if (!row) {
        const inserted = await this.#db.get<{ key: string }>(
          `INSERT INTO ${this.#table} (key, value, expiration) VALUES (?, ?, 0) ON CONFLICT (key) DO NOTHING RETURNING key`,
          [k, JSON.stringify(value)],
        );
        if (inserted) return value;
        continue; // somebody created it first: add to theirs
      }

      let current: unknown;
      try {
        current = JSON.parse(row.value);
      } catch {
        current = undefined;
      }
      const next = counterBase(current) + value;
      const swapped = await this.#db.get<{ key: string }>(
        `UPDATE ${this.#table} SET value = ? WHERE key = ? AND value = ? RETURNING key`,
        [JSON.stringify(next), k, row.value],
      );
      if (swapped) return next;
    }
    throw new Error(`Could not increment cache key [${key}]: too many concurrent changes.`);
  }

  async decrement(key: string, value = 1): Promise<number> {
    return this.increment(key, -value);
  }
}
