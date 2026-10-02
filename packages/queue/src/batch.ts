/**
 * Job batch progress and lifecycle.
 */

import type { Job } from "./job.ts";

export type BatchRecord = {
  id: string;
  name: string;
  totalJobs: number;
  pendingJobs: number;
  failedJobs: number;
  failedJobIds: string[];
  cancelledAt: number | null;
  createdAt: number;
  finishedAt: number | null;
};

export type BatchCallbacks = {
  then?: (batch: Batch) => void | Promise<void>;
  catch?: (batch: Batch, error: Error) => void | Promise<void>;
  finally?: (batch: Batch) => void | Promise<void>;
  progress?: (batch: Batch) => void | Promise<void>;
  allowFailures?: boolean | ((batch: Batch, error: Error) => void | Promise<void>);
};

export class Batch {
  constructor(readonly record: BatchRecord) {}

  get id(): string {
    return this.record.id;
  }

  get name(): string {
    return this.record.name;
  }

  get totalJobs(): number {
    return this.record.totalJobs;
  }

  get pendingJobs(): number {
    return this.record.pendingJobs;
  }

  get failedJobs(): number {
    return this.record.failedJobs;
  }

  get failedJobIds(): string[] {
    return [...this.record.failedJobIds];
  }

  get cancelledAt(): number | null {
    return this.record.cancelledAt;
  }

  get createdAt(): number {
    return this.record.createdAt;
  }

  get finishedAt(): number | null {
    return this.record.finishedAt;
  }

  /** Whether all jobs have finished (success or failure). */
  finished(): boolean {
    return this.record.finishedAt !== null;
  }

  cancelled(): boolean {
    return this.record.cancelledAt !== null;
  }

  /** Alias spelled `canceled`. */
  canceled(): boolean {
    return this.cancelled();
  }

  /** Percent complete (0–100). */
  progress(): number {
    if (this.record.totalJobs === 0) return 100;
    const done = this.record.totalJobs - this.record.pendingJobs;
    return Math.floor((done / this.record.totalJobs) * 100);
  }

  /** Whether every job completed without failure. */
  successful(): boolean {
    return this.finished() && this.record.failedJobs === 0 && !this.cancelled();
  }

  allowsFailures(): boolean {
    const cb = getBatchCallbacks(this.id)?.allowFailures;
    return Boolean(cb);
  }

  hasFailures(): boolean {
    return this.record.failedJobs > 0;
  }

  processedJobs(): number {
    return this.record.totalJobs - this.record.pendingJobs;
  }

  hasThenCallbacks(): boolean {
    return Boolean(getBatchCallbacks(this.id)?.then);
  }

  hasCatchCallbacks(): boolean {
    return Boolean(getBatchCallbacks(this.id)?.catch);
  }

  hasFinallyCallbacks(): boolean {
    return Boolean(getBatchCallbacks(this.id)?.finally);
  }

  hasProgressCallbacks(): boolean {
    return Boolean(getBatchCallbacks(this.id)?.progress);
  }

  hasFailureCallbacks(): boolean {
    return Boolean(getBatchCallbacks(this.id)?.allowFailures);
  }

  /** Cancel remaining jobs. */
  async cancel(): Promise<void> {
    const { getBatchRepository } = await import("./bus.ts");
    await getBatchRepository().update(this.id, {
      cancelledAt: Math.floor(Date.now() / 1000),
    });
    this.record.cancelledAt = Math.floor(Date.now() / 1000);
  }

  /** Delete the batch record. */
  async delete(): Promise<void> {
    const { getBatchRepository } = await import("./bus.ts");
    const repo = getBatchRepository();
    if (typeof repo.delete === "function") {
      await repo.delete(this.id);
    }
  }

  /** Reload batch state from the repository. */
  async fresh(): Promise<Batch | null> {
    const { getBatchRepository } = await import("./bus.ts");
    const record = await getBatchRepository().find(this.id);
    return record ? new Batch(record) : null;
  }

  /** Add jobs to a running batch. */
  async add(jobs: Job | Job[]): Promise<this> {
    const list = Array.isArray(jobs) ? jobs : [jobs];
    const { getBatchRepository } = await import("./bus.ts");
    const { getQueue } = await import("./manager.ts");
    const repo = getBatchRepository();
    const current = await repo.find(this.id);
    if (!current || current.finishedAt !== null || current.cancelledAt !== null) {
      return this;
    }
    await repo.update(this.id, {
      totalJobs: current.totalJobs + list.length,
      pendingJobs: current.pendingJobs + list.length,
    });
    this.record.totalJobs += list.length;
    this.record.pendingJobs += list.length;
    for (const job of list) {
      await getQueue().dispatch(job, { batchId: this.id });
    }
    return this;
  }
}

export interface BatchRepository {
  store(record: BatchRecord): Promise<void>;
  find(id: string): Promise<BatchRecord | null>;
  update(id: string, patch: Partial<BatchRecord>): Promise<BatchRecord | null>;
  delete?(id: string): Promise<void>;
}

/**
 * In-memory batch store (tests / single-process).
 */
export class MemoryBatchRepository implements BatchRepository {
  readonly #batches = new Map<string, BatchRecord>();

  async store(record: BatchRecord): Promise<void> {
    this.#batches.set(record.id, structuredClone(record));
  }

  async find(id: string): Promise<BatchRecord | null> {
    const row = this.#batches.get(id);
    return row ? structuredClone(row) : null;
  }

  async update(
    id: string,
    patch: Partial<BatchRecord>,
  ): Promise<BatchRecord | null> {
    const current = this.#batches.get(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    if (patch.failedJobIds) next.failedJobIds = [...patch.failedJobIds];
    this.#batches.set(id, next);
    return structuredClone(next);
  }

  async delete(id: string): Promise<void> {
    this.#batches.delete(id);
  }
}

/** Minimal DB surface for the `job_batches` table. */
export type BatchConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
};

export type DatabaseBatchRepositoryOptions = {
  connection: BatchConnection;
  table?: string;
};

type BatchRow = {
  id: string;
  name: string;
  total_jobs: number;
  pending_jobs: number;
  failed_jobs: number;
  failed_job_ids: string;
  cancelled_at: number | null;
  created_at: number;
  finished_at: number | null;
};

/**
 * Database batch store (`job_batches` table).
 */
export class DatabaseBatchRepository implements BatchRepository {
  readonly #db: BatchConnection;
  readonly #table: string;

  constructor(options: DatabaseBatchRepositoryOptions) {
    this.#db = options.connection;
    this.#table = options.table ?? "job_batches";
  }

  async store(record: BatchRecord): Promise<void> {
    await this.#db.run(
      `INSERT INTO ${this.#table}
        (id, name, total_jobs, pending_jobs, failed_jobs, failed_job_ids, cancelled_at, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.name,
        record.totalJobs,
        record.pendingJobs,
        record.failedJobs,
        JSON.stringify(record.failedJobIds),
        record.cancelledAt,
        record.createdAt,
        record.finishedAt,
      ],
    );
  }

  async find(id: string): Promise<BatchRecord | null> {
    const row = await this.#db.get<BatchRow>(
      `SELECT * FROM ${this.#table} WHERE id = ?`,
      [id],
    );
    return row ? this.#fromRow(row) : null;
  }

  async update(
    id: string,
    patch: Partial<BatchRecord>,
  ): Promise<BatchRecord | null> {
    const current = await this.find(id);
    if (!current) return null;
    const next: BatchRecord = {
      ...current,
      ...patch,
      failedJobIds: patch.failedJobIds
        ? [...patch.failedJobIds]
        : current.failedJobIds,
    };
    await this.#db.run(
      `UPDATE ${this.#table} SET
        name = ?, total_jobs = ?, pending_jobs = ?, failed_jobs = ?,
        failed_job_ids = ?, cancelled_at = ?, finished_at = ?
       WHERE id = ?`,
      [
        next.name,
        next.totalJobs,
        next.pendingJobs,
        next.failedJobs,
        JSON.stringify(next.failedJobIds),
        next.cancelledAt,
        next.finishedAt,
        id,
      ],
    );
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.#db.run(`DELETE FROM ${this.#table} WHERE id = ?`, [id]);
  }

  #fromRow(row: BatchRow): BatchRecord {
    let failedJobIds: string[] = [];
    try {
      failedJobIds = JSON.parse(row.failed_job_ids) as string[];
    } catch {
      failedJobIds = [];
    }
    return {
      id: row.id,
      name: row.name,
      totalJobs: row.total_jobs,
      pendingJobs: row.pending_jobs,
      failedJobs: row.failed_jobs,
      failedJobIds,
      cancelledAt: row.cancelled_at,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    };
  }
}

/** Process-local batch callbacks (not persisted across workers). */
const batchCallbacks = new Map<string, BatchCallbacks>();

export function setBatchCallbacks(
  id: string,
  callbacks: BatchCallbacks,
): void {
  batchCallbacks.set(id, callbacks);
}

export function getBatchCallbacks(id: string): BatchCallbacks | undefined {
  return batchCallbacks.get(id);
}

export function clearBatchCallbacks(id: string): void {
  batchCallbacks.delete(id);
}
