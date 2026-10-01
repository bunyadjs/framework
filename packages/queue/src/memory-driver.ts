import type { JobPayload, QueueDriver } from "@bunyad/contracts";

type StoredPayload = JobPayload;

/**
 * In-memory queue — jobs wait until `work()` / `pop()`.
 * Honors `availableAt` (delayed jobs are skipped until ready).
 */
export class MemoryQueueDriver implements QueueDriver {
  readonly #queues = new Map<string, StoredPayload[]>();

  async push(queue: string, payload: JobPayload): Promise<void> {
    const list = this.#queues.get(queue) ?? [];
    list.push(payload);
    this.#queues.set(queue, list);
  }

  async pop(queue: string): Promise<JobPayload | undefined> {
    const list = this.#queues.get(queue);
    if (!list || list.length === 0) return undefined;

    const now = Math.floor(Date.now() / 1000);
    const index = list.findIndex(
      (job) => job.availableAt === undefined || job.availableAt <= now,
    );
    if (index === -1) return undefined;

    const [job] = list.splice(index, 1);
    return job;
  }

  async size(queue: string): Promise<number> {
    return this.#queues.get(queue)?.length ?? 0;
  }
}
