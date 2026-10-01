import type { Job } from "./job.ts";
import { runJob } from "./middleware.ts";
import {
  Batch,
  clearBatchCallbacks,
  getBatchCallbacks,
  type BatchCallbacks,
  type BatchRecord,
  type BatchRepository,
  MemoryBatchRepository,
  setBatchCallbacks,
} from "./batch.ts";
import { getQueue } from "./manager.ts";
import { PendingDispatch } from "./pending-dispatch.ts";

let batchRepository: BatchRepository = new MemoryBatchRepository();

/** Configure where batch progress is stored (default: memory). */
export function setBatchRepository(repo: BatchRepository): void {
  batchRepository = repo;
}

export function getBatchRepository(): BatchRepository {
  return batchRepository;
}

/**
 * Fluent chain builder (`Bus::chain([...])->dispatch()`).
 */
export class PendingChain {
  readonly #jobs: Job[];
  #catch?: (error: Error) => void | Promise<void>;
  #delay?: number;
  #queue?: string;

  constructor(jobs: Job[]) {
    this.#jobs = jobs;
  }

  catch(callback: (error: Error) => void | Promise<void>): this {
    this.#catch = callback;
    return this;
  }

  delay(seconds: number): this {
    this.#delay = seconds;
    return this;
  }

  onQueue(queue: string): this {
    this.#queue = queue;
    return this;
  }

  async dispatch(): Promise<string | undefined> {
    if (this.#jobs.length === 0) return undefined;
    const [first, ...rest] = this.#jobs;
    if (this.#queue) first.queue = this.#queue;
    if (this.#delay !== undefined) first.delay = this.#delay;

    return getQueue().dispatch(first, {
      chain: rest,
      delay: this.#delay,
      onChainFailure: this.#catch,
    });
  }
}

/**
 * Fluent batch builder (`Bus::batch([...])->then(...)->dispatch()`).
 */
export class PendingBatch {
  readonly #jobs: Job[];
  #name = "";
  #queue?: string;
  #callbacks: BatchCallbacks = {};

  constructor(jobs: Job[]) {
    this.#jobs = jobs;
  }

  name(name: string): this {
    this.#name = name;
    return this;
  }

  onQueue(queue: string): this {
    this.#queue = queue;
    return this;
  }

  then(callback: (batch: Batch) => void | Promise<void>): this {
    this.#callbacks.then = callback;
    return this;
  }

  catch(
    callback: (batch: Batch, error: Error) => void | Promise<void>,
  ): this {
    this.#callbacks.catch = callback;
    return this;
  }

  finally(callback: (batch: Batch) => void | Promise<void>): this {
    this.#callbacks.finally = callback;
    return this;
  }

  progress(callback: (batch: Batch) => void | Promise<void>): this {
    this.#callbacks.progress = callback;
    return this;
  }

  allowFailures(
    callback?: (batch: Batch, error: Error) => void | Promise<void>,
  ): this {
    this.#callbacks.allowFailures = callback ?? true;
    return this;
  }

  async dispatch(): Promise<Batch> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const record: BatchRecord = {
      id,
      name: this.#name,
      totalJobs: this.#jobs.length,
      pendingJobs: this.#jobs.length,
      failedJobs: 0,
      failedJobIds: [],
      cancelledAt: null,
      createdAt: now,
      finishedAt: this.#jobs.length === 0 ? now : null,
    };

    await batchRepository.store(record);
    setBatchCallbacks(id, this.#callbacks);

    const batch = new Batch(record);
    if (this.#jobs.length === 0) {
      await this.#callbacks.then?.(batch);
      await this.#callbacks.finally?.(batch);
      clearBatchCallbacks(id);
      return batch;
    }

    const q = getQueue();
    for (const job of this.#jobs) {
      if (this.#queue) job.queue = this.#queue;
      await q.dispatch(job, { batchId: id });
    }

    const fresh = await batchRepository.find(id);
    return new Batch(fresh ?? record);
  }
}

/**
 * Bus facade — `Bus.chain` / `Bus.batch` / `Bus.findBatch`.
 */
export const Bus = {
  chain(jobs: Job[]): PendingChain {
    return new PendingChain(jobs);
  },

  batch(jobs: Job[]): PendingBatch {
    return new PendingBatch(jobs);
  },

  async findBatch(id: string): Promise<Batch | null> {
    const record = await batchRepository.find(id);
    return record ? new Batch(record) : null;
  },

  dispatch(job: Job): PendingDispatch {
    return new PendingDispatch(job);
  },

  /** Run the job immediately on the sync path (Laravel `Bus::dispatchSync`). */
  async dispatchSync(job: Job): Promise<void> {
    await runJob(job);
  },

  /** Alias of `dispatchSync` (Laravel `dispatchNow`). */
  async dispatchNow(job: Job): Promise<void> {
    return Bus.dispatchSync(job);
  },

  /** Dispatch many jobs (Laravel `Bus::bulk`). */
  async bulk(jobs: Job[], queue?: string): Promise<string[]> {
    const ids: string[] = [];
    for (const job of jobs) {
      if (queue) job.queue = queue;
      ids.push(await getQueue().dispatch(job));
    }
    return ids;
  },

  /** Dispatch after the current response turn (Laravel `Bus::dispatchAfterResponse`). */
  dispatchAfterResponse(job: Job): PendingDispatch {
    return new PendingDispatch(job).afterResponse();
  },
};

/** Update batch progress after a job succeeds or permanently fails. */
export async function recordBatchJobResult(
  batchId: string,
  jobId: string,
  error: Error | null,
): Promise<void> {
  const current = await batchRepository.find(batchId);
  if (!current || current.finishedAt !== null) return;

  const callbacks = getBatchCallbacks(batchId);
  const failedJobIds = [...current.failedJobIds];
  let failedJobs = current.failedJobs;
  const pendingJobs = Math.max(0, current.pendingJobs - 1);
  let cancelledAt = current.cancelledAt;
  const firstFailure = error !== null && current.failedJobs === 0;

  if (error) {
    failedJobs += 1;
    failedJobIds.push(jobId);

    const allow = callbacks?.allowFailures;
    if (!allow) {
      cancelledAt = Math.floor(Date.now() / 1000);
    }
  }

  const finishedAt =
    pendingJobs === 0 ? Math.floor(Date.now() / 1000) : null;

  const updated = await batchRepository.update(batchId, {
    pendingJobs,
    failedJobs,
    failedJobIds,
    cancelledAt,
    finishedAt,
  });
  if (!updated) return;

  const batch = new Batch(updated);

  if (error && callbacks) {
    const allow = callbacks.allowFailures;
    if (typeof allow === "function") {
      await allow(batch, error);
    }
    if (firstFailure) {
      await callbacks.catch?.(batch, error);
    }
  }

  if (!error) {
    await callbacks?.progress?.(batch);
  }

  if (finishedAt !== null) {
    if (updated.failedJobs === 0 && updated.cancelledAt === null) {
      await callbacks?.then?.(batch);
    }
    await callbacks?.finally?.(batch);
    clearBatchCallbacks(batchId);
  }
}

/** Whether a batch has been cancelled (remaining jobs should be skipped). */
export async function isBatchCancelled(batchId: string): Promise<boolean> {
  const record = await batchRepository.find(batchId);
  return record?.cancelledAt !== null && record !== null;
}
