import type { FailedJobRecord, FailedJobRepository } from "./failed.ts";

/**
 * In-memory failed job store (tests / sync).
 */
export class MemoryFailedJobRepository implements FailedJobRepository {
  readonly #jobs = new Map<string, FailedJobRecord>();

  async store(job: FailedJobRecord): Promise<void> {
    this.#jobs.set(job.id, job);
  }

  async all(): Promise<FailedJobRecord[]> {
    return [...this.#jobs.values()].sort((a, b) => b.failedAt - a.failedAt);
  }

  async find(id: string): Promise<FailedJobRecord | undefined> {
    return this.#jobs.get(id);
  }

  async forget(id: string): Promise<boolean> {
    return this.#jobs.delete(id);
  }

  async flush(): Promise<void> {
    this.#jobs.clear();
  }
}
