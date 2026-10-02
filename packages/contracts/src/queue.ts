/**
 * Queue driver contract.
 */
export type ChainedJobPayload = {
  name: string;
  data: unknown;
  queue?: string;
  maxTries?: number;
  /** Delay in seconds before this chained job becomes available. */
  delay?: number;
  /** When true, restore ORM models in `data` before handling. */
  serializesModels?: boolean;
  timeout?: number;
  backoff?: number | number[];
  retryUntil?: number | null;
  maxExceptions?: number | null;
};

export interface JobPayload {
  id: string;
  name: string;
  data: unknown;
  attempts: number;
  /** Unix timestamp when the job becomes available (delay). */
  availableAt?: number;
  /** Remaining jobs in a chain (run after this job succeeds). */
  chain?: ChainedJobPayload[];
  /** Job batch id when dispatched via `Bus.batch`. */
  batchId?: string;
  /** When true, restore ORM models in `data` before handling. */
  serializesModels?: boolean;
}

export interface QueueDriver {
  push(queue: string, payload: JobPayload): Promise<void>;
  pop(queue: string): Promise<JobPayload | undefined>;
  size(queue: string): Promise<number>;
}
