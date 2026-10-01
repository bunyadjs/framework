import type { FailedJobRecord, FailedJobRepository } from "./failed.ts";

export type FailedJobConnection = {
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

export type DatabaseFailedJobRepositoryOptions = {
  connection: FailedJobConnection;
  table?: string;
};

type FailedRow = {
  uuid: string;
  queue: string;
  payload: string;
  exception: string;
  failed_at: number;
};

/**
 * Persist failed jobs to a `failed_jobs` table.
 */
export class DatabaseFailedJobRepository implements FailedJobRepository {
  readonly #db: FailedJobConnection;
  readonly #table: string;

  constructor(options: DatabaseFailedJobRepositoryOptions) {
    this.#db = options.connection;
    this.#table = options.table ?? "failed_jobs";
  }

  async store(job: FailedJobRecord): Promise<void> {
    await this.#db.run(
      `INSERT INTO ${this.#table} (uuid, queue, payload, exception, failed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        job.id,
        job.queue,
        JSON.stringify(job.payload),
        job.exception,
        job.failedAt,
      ],
    );
  }

  async all(): Promise<FailedJobRecord[]> {
    const rows = await this.#db.all<FailedRow>(
      `SELECT uuid, queue, payload, exception, failed_at FROM ${this.#table} ORDER BY failed_at DESC`,
    );
    return rows.map(mapRow);
  }

  async find(id: string): Promise<FailedJobRecord | undefined> {
    const row = await this.#db.get<FailedRow>(
      `SELECT uuid, queue, payload, exception, failed_at FROM ${this.#table} WHERE uuid = ?`,
      [id],
    );
    return row ? mapRow(row) : undefined;
  }

  async forget(id: string): Promise<boolean> {
    const before = await this.find(id);
    if (!before) return false;
    await this.#db.run(`DELETE FROM ${this.#table} WHERE uuid = ?`, [id]);
    return true;
  }

  async flush(): Promise<void> {
    await this.#db.run(`DELETE FROM ${this.#table}`);
  }
}

function mapRow(row: FailedRow): FailedJobRecord {
  return {
    id: row.uuid,
    queue: row.queue,
    payload: JSON.parse(row.payload) as FailedJobRecord["payload"],
    exception: row.exception,
    failedAt: row.failed_at,
  };
}
