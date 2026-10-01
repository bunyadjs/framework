/** Minimal DB surface — satisfied by `@bunyad/database` Connection. */
export type SessionConnection = {
  /** Returns rows affected when backed by Connection (`Promise<number>`). */
  run(
    sql: string,
    params?: unknown[],
  ): void | number | Promise<void | number>;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
};

export type DatabaseSessionStoreOptions = {
  connection: SessionConnection;
  /** Table name (Laravel default `sessions`). */
  table?: string;
  /**
   * Session lifetime in minutes (Laravel `lifetime`).
   * Expired rows are treated as missing on read.
   */
  lifetime?: number;
};

type SessionRow = {
  id: string;
  payload: string;
  last_activity: number;
};

function assertTable(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid sessions table name [${table}].`);
  }
  return table;
}

/**
 * Laravel `database` session driver — JSON payload in a `sessions` table.
 *
 * Expected schema (Laravel-compatible subset):
 * ```sql
 * CREATE TABLE sessions (
 *   id TEXT PRIMARY KEY,
 *   user_id INTEGER NULL,
 *   ip_address TEXT NULL,
 *   user_agent TEXT NULL,
 *   payload TEXT NOT NULL,
 *   last_activity INTEGER NOT NULL
 * );
 * ```
 */
export class DatabaseSessionStore {
  readonly #db: SessionConnection;
  readonly #table: string;
  readonly #lifetimeSeconds: number;

  constructor(options: DatabaseSessionStoreOptions) {
    this.#db = options.connection;
    this.#table = assertTable(options.table ?? "sessions");
    this.#lifetimeSeconds = (options.lifetime ?? 120) * 60;
  }

  async read(id: string): Promise<Record<string, unknown> | undefined> {
    const row = await this.#db.get<SessionRow>(
      `SELECT id, payload, last_activity FROM ${this.#table} WHERE id = ?`,
      [id],
    );
    if (!row) return undefined;
    const minActivity = Math.floor(Date.now() / 1000) - this.#lifetimeSeconds;
    if (Number(row.last_activity) < minActivity) {
      await this.destroy(id);
      return undefined;
    }
    try {
      return JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  async write(id: string, data: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(data);
    const now = Math.floor(Date.now() / 1000);
    const existing = await this.#db.get<{ id: string }>(
      `SELECT id FROM ${this.#table} WHERE id = ?`,
      [id],
    );
    if (existing) {
      await this.#db.run(
        `UPDATE ${this.#table} SET payload = ?, last_activity = ? WHERE id = ?`,
        [payload, now, id],
      );
      return;
    }
    await this.#db.run(
      `INSERT INTO ${this.#table} (id, payload, last_activity) VALUES (?, ?, ?)`,
      [id, payload, now],
    );
  }

  async destroy(id: string): Promise<void> {
    await this.#db.run(`DELETE FROM ${this.#table} WHERE id = ?`, [id]);
  }
}
