import type { JobPayload } from "@bunyad/contracts";

export type FailedJobRecord = {
  id: string;
  queue: string;
  payload: JobPayload;
  exception: string;
  failedAt: number;
};

/**
 * Failed jobs repository.
 */
export interface FailedJobRepository {
  store(job: FailedJobRecord): Promise<void>;
  all(): Promise<FailedJobRecord[]>;
  find(id: string): Promise<FailedJobRecord | undefined>;
  forget(id: string): Promise<boolean>;
  flush(): Promise<void>;
}
