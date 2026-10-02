import type { FeatureStore } from "./types.ts";

/** Minimal DB surface — satisfied by `@bunyad/database` Connection. */
export type FeatureConnection = {
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

export type DatabaseFeatureStoreOptions = {
  connection: FeatureConnection;
  /** Table name. */
  table?: string;
};

type FeatureRow = {
  name: string;
  scope: string;
  value: string;
};

function assertTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid features table name [${table}].`);
  }
  return table;
}

/**
 * Database driver — JSON values in a `features` table.
 *
 * Expected schema:
 * ```sql
 * CREATE TABLE features (
 *   id INTEGER PRIMARY KEY,
 *   name TEXT NOT NULL,
 *   scope TEXT NOT NULL,
 *   value TEXT NOT NULL,
 *   created_at TEXT NULL,
 *   updated_at TEXT NULL,
 *   UNIQUE(name, scope)
 * );
 * ```
 */
export class DatabaseFeatureStore implements FeatureStore {
  readonly #db: FeatureConnection;
  readonly #table: string;

  constructor(options: DatabaseFeatureStoreOptions) {
    this.#db = options.connection;
    this.#table = assertTable(options.table ?? "features");
  }

  async get(name: string, scope: string): Promise<unknown | undefined> {
    const row = await this.#db.get<FeatureRow>(
      `SELECT name, scope, value FROM ${this.#table} WHERE name = ? AND scope = ?`,
      [name, scope],
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return row.value;
    }
  }

  async set(name: string, scope: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    const encoded = JSON.stringify(value);
    const existing = await this.#db.get<{ name: string }>(
      `SELECT name FROM ${this.#table} WHERE name = ? AND scope = ?`,
      [name, scope],
    );
    if (existing) {
      await this.#db.run(
        `UPDATE ${this.#table} SET value = ?, updated_at = ? WHERE name = ? AND scope = ?`,
        [encoded, now, name, scope],
      );
      return;
    }
    await this.#db.run(
      `INSERT INTO ${this.#table} (name, scope, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [name, scope, encoded, now, now],
    );
  }

  async delete(name: string, scope: string): Promise<void> {
    await this.#db.run(
      `DELETE FROM ${this.#table} WHERE name = ? AND scope = ?`,
      [name, scope],
    );
  }

  async purge(name?: string | string[]): Promise<void> {
    if (name == null) {
      await this.#db.run(`DELETE FROM ${this.#table}`);
      return;
    }
    const names = Array.isArray(name) ? name : [name];
    if (names.length === 0) return;
    const placeholders = names.map(() => "?").join(", ");
    await this.#db.run(
      `DELETE FROM ${this.#table} WHERE name IN (${placeholders})`,
      names,
    );
  }
}
