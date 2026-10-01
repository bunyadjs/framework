import type { JobPayload, QueueDriver } from "@bunyad/contracts";
import { Crypt } from "@bunyad/common";

/** Minimal DB surface — satisfied by `@bunyad/database` Connection. */
export type QueueConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
  all?<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[] | Promise<T[]>;
};

export type DatabaseQueueDriverOptions = {
  connection: QueueConnection;
  table?: string;
  /** Encrypt JSON payloads at rest (`Crypt`, requires APP_KEY). */
  encrypt?: boolean;
};

type JobRow = {
  id: number;
  queue: string;
  payload: string;
  attempts: number;
};

/**
 * Database queue driver — JSON payloads in a `jobs` table.
 * Uses `available_at` for delayed jobs.
 */
export class DatabaseQueueDriver implements QueueDriver {
  readonly serializes = true;
  readonly #db: QueueConnection;
  readonly #table: string;
  readonly #encrypt: boolean;

  constructor(options: DatabaseQueueDriverOptions) {
    this.#db = options.connection;
    this.#table = options.table ?? "jobs";
    this.#encrypt = options.encrypt === true;
  }

  #encodePayload(payload: JobPayload): string {
    const json = JSON.stringify(payload);
    if (!this.#encrypt) return json;
    return Crypt.encryptString(json);
  }

  #decodePayload(raw: string): JobPayload {
    let json = raw;
    if (this.#encrypt) {
      json = Crypt.decryptString(raw);
    }
    return JSON.parse(json) as JobPayload;
  }

  async push(queue: string, payload: JobPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const availableAt = payload.availableAt ?? now;
    await this.#db.run(
      `INSERT INTO ${this.#table} (queue, payload, attempts, reserved_at, available_at, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      [queue, this.#encodePayload(payload), payload.attempts, availableAt, now],
    );
  }

  async pop(queue: string): Promise<JobPayload | undefined> {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.#db.get<JobRow>(
      `SELECT id, queue, payload, attempts FROM ${this.#table}
       WHERE queue = ? AND reserved_at IS NULL AND available_at <= ?
       ORDER BY id ASC LIMIT 1`,
      [queue, now],
    );
    if (!row) return undefined;

    await this.#db.run(`UPDATE ${this.#table} SET reserved_at = ? WHERE id = ?`, [
      now,
      row.id,
    ]);

    const parsed = this.#decodePayload(row.payload);
    parsed.attempts = row.attempts;

    await this.#db.run(`DELETE FROM ${this.#table} WHERE id = ?`, [row.id]);
    return parsed;
  }

  async size(queue: string): Promise<number> {
    const row = await this.#db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM ${this.#table} WHERE queue = ? AND reserved_at IS NULL`,
      [queue],
    );
    return row?.c ?? 0;
  }
}
