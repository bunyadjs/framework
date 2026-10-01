import type { JobPayload, QueueDriver } from "@bunyad/contracts";

export type SyncHandler = (payload: JobPayload) => void | Promise<void>;

/**
 * Sync driver — runs the job immediately on push.
 * Delay is ignored (same as the sync connection).
 */
export class SyncQueueDriver implements QueueDriver {
  constructor(private readonly handle: SyncHandler) {}

  async push(_queue: string, payload: JobPayload): Promise<void> {
    await this.handle(payload);
  }

  async pop(_queue: string): Promise<JobPayload | undefined> {
    return undefined;
  }

  async size(_queue: string): Promise<number> {
    return 0;
  }
}
