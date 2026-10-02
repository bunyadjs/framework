import type {
  ChainedJobPayload,
  JobPayload,
  QueueDriver,
} from "@bunyad/contracts";
import type { FailedJobRepository } from "./failed.ts";
import type { Job } from "./job.ts";
import { MemoryQueueDriver } from "./memory-driver.ts";
import { PendingDispatch } from "./pending-dispatch.ts";
import {
  jobSerializesModels,
  restoreJobFields,
  serializeJobFields,
} from "./serializes-models.ts";
import { SyncQueueDriver } from "./sync-driver.ts";
import { isJobInstance, runJob } from "./middleware.ts";
import {
  acquireUniqueJobLock,
  jobImplementsUnique,
  jobUniqueUntilProcessing,
  releaseUniqueJobLock,
} from "./unique.ts";
import { applyQueueRoute, queueRoutes } from "./queue-routes.ts";

export type JobHandler = (data: unknown) => void | Promise<void>;

export type QueueConnectionName = "sync" | "memory" | "database" | "redis";

export type QueueManagerOptions = {
  default?: string;
  /** `sync` | `memory` (default sync). Use `driver` for database/redis. */
  connection?: QueueConnectionName;
  driver?: QueueDriver;
  /** Default max attempts when a job does not set `tries`. */
  tries?: number;
  /** Where to record permanently failed jobs. */
  failed?: FailedJobRepository;
};

export type DispatchOptions = {
  chain?: Job[];
  delay?: number;
  batchId?: string;
  onChainFailure?: (error: Error) => void | Promise<void>;
};

type SerializableDriver = QueueDriver & { serializes?: boolean };

type InternalPayload = JobPayload & {
  maxTries?: number;
  timeout?: number;
  backoff?: number | number[];
  retryUntil?: number | null;
  maxExceptions?: number | null;
  /** Count of unhandled exceptions so far (`$maxExceptions`). */
  exceptions?: number;
  onChainFailure?: (error: Error) => void | Promise<void>;
};

function resolveBackoff(
  backoff: number | number[] | undefined,
  attempt: number,
): number {
  if (backoff === undefined) return 0;
  if (Array.isArray(backoff)) {
    if (backoff.length === 0) return 0;
    const idx = Math.min(Math.max(attempt - 1, 0), backoff.length - 1);
    return Number(backoff[idx] ?? 0);
  }
  return Number(backoff) || 0;
}

function resolveRetryUntil(job: Job): number | null {
  const raw = job.retryUntil();
  if (raw instanceof Date) {
    return Math.floor(raw.getTime() / 1000);
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return null;
}

function jobWorkerOptions(job: Job): {
  timeout: number;
  backoff: number | number[];
  retryUntil: number | null;
  maxExceptions: number | null;
} {
  return {
    timeout: job.timeout,
    backoff: job.backoff,
    retryUntil: resolveRetryUntil(job),
    maxExceptions: job.maxExceptions,
  };
}

async function runWithTimeout(
  run: () => void | Promise<void>,
  timeoutSeconds: number,
): Promise<void> {
  if (!timeoutSeconds || timeoutSeconds <= 0) {
    await run();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(run),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Job timed out")),
          timeoutSeconds * 1000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function jobPayloadData(job: Job, driverSerializes: boolean): {
  data: unknown;
  serializesModels: boolean;
} {
  const serializesModels = jobSerializesModels(job);
  if (driverSerializes || serializesModels) {
    return {
      data: serializeJobFields(job, serializesModels),
      serializesModels,
    };
  }
  return { data: job, serializesModels: false };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Queue manager: `dispatch(job)`, `push(name, data)`, `work()`, `later()`.
 */
export class QueueManager {
  readonly #handlers = new Map<string, JobHandler>();
  readonly #defaultQueue: string;
  #tries: number;
  #defaultTimeout: number | undefined;
  readonly #failed?: FailedJobRepository;
  readonly driver: QueueDriver;

  constructor(options: QueueManagerOptions = {}) {
    this.#defaultQueue = options.default ?? "default";
    this.#tries = options.tries ?? 1;
    this.#failed = options.failed;

    if (options.driver) {
      this.driver = options.driver;
    } else if (options.connection === "memory") {
      this.driver = new MemoryQueueDriver();
    } else if (
      options.connection === "database" ||
      options.connection === "redis"
    ) {
      throw new Error(
        `Queue connection [${options.connection}] requires an explicit driver instance.`,
      );
    } else {
      this.driver = new SyncQueueDriver((payload) => this.#run(payload));
    }
  }

  get failed(): FailedJobRepository | undefined {
    return this.#failed;
  }

  /** Default max attempts (`queue:work --tries`). */
  get tries(): number {
    return this.#tries;
  }

  set tries(value: number) {
    this.#tries = Math.max(1, Math.trunc(value));
  }

  /** Default job timeout in seconds (`queue:work --timeout`). */
  get defaultTimeout(): number | undefined {
    return this.#defaultTimeout;
  }

  set defaultTimeout(value: number | undefined) {
    this.#defaultTimeout =
      value === undefined ? undefined : Math.max(0, Number(value));
  }

  /** Register a named job handler (for push/work). */
  register(name: string, handler: JobHandler): this {
    this.#handlers.set(name, handler);
    return this;
  }

  #ensureJobHandler(job: Job): void {
    const name = job.constructor.name;
    if (this.#handlers.has(name)) return;
    const proto = Object.getPrototypeOf(job) as object;
    this.register(name, async (data) => {
      if (isJobInstance(data)) {
        await runJob(data);
        return;
      }
      const handle = (proto as Job).handle;
      await handle.call(data as Job);
    });
  }

  #serializeChain(jobs: Job[]): ChainedJobPayload[] {
    const driverSerializes =
      (this.driver as SerializableDriver).serializes === true;
    return jobs.map((job) => {
      this.#ensureJobHandler(job);
      const { data, serializesModels } = jobPayloadData(job, driverSerializes);
      const worker = jobWorkerOptions(job);
      return {
        name: job.constructor.name,
        data,
        queue: job.queue,
        maxTries: job.tries,
        delay: job.delay > 0 ? job.delay : undefined,
        serializesModels: serializesModels || undefined,
        timeout: worker.timeout,
        backoff: worker.backoff,
        retryUntil: worker.retryUntil,
        maxExceptions: worker.maxExceptions ?? undefined,
      };
    });
  }

  async push(
    name: string,
    data: unknown = {},
    queue = this.#defaultQueue,
    options: {
      attempts?: number;
      maxTries?: number;
      id?: string;
      delay?: number;
      availableAt?: number;
      chain?: ChainedJobPayload[];
      batchId?: string;
      onChainFailure?: (error: Error) => void | Promise<void>;
      serializesModels?: boolean;
      timeout?: number;
      backoff?: number | number[];
      retryUntil?: number | null;
      maxExceptions?: number | null;
      exceptions?: number;
    } = {},
  ): Promise<string> {
    const delaySeconds = options.delay ?? 0;
    const availableAt =
      options.availableAt ??
      (delaySeconds > 0 ? nowSeconds() + delaySeconds : undefined);

    const payload: InternalPayload = {
      id: options.id ?? crypto.randomUUID(),
      name,
      data,
      attempts: options.attempts ?? 0,
      maxTries: options.maxTries,
      availableAt,
      chain: options.chain,
      batchId: options.batchId,
      onChainFailure: options.onChainFailure,
      serializesModels: options.serializesModels,
      timeout: options.timeout,
      backoff: options.backoff,
      retryUntil: options.retryUntil,
      maxExceptions: options.maxExceptions,
      exceptions: options.exceptions,
    };
    await this.driver.push(queue, payload);
    return payload.id;
  }

  /**
   * Dispatch a Job instance.
   * Prefer the top-level `dispatch()` helper for fluent `delay` / `chain`.
   */
  async dispatch(job: Job, options: DispatchOptions = {}): Promise<string> {
    this.#ensureJobHandler(job);
    for (const chained of options.chain ?? []) {
      this.#ensureJobHandler(chained);
    }

    applyQueueRoute(job, queueRoutes());

    // Route to a named connection when configured.
    if (job.connection) {
      const { Queue } = await import("./queue-fake.ts");
      if (Queue.connected(job.connection) && job.connection !== Queue.getDefaultDriver()) {
        const other = Queue.connection(job.connection);
        if (other !== this) {
          const routed = job.connection;
          job.connection = null; // prevent re-entry
          try {
            return await other.dispatch(job, options);
          } finally {
            job.connection = routed;
          }
        }
      }
    }

    if (jobImplementsUnique(job)) {
      const acquired = await acquireUniqueJobLock(job);
      if (!acquired) {
        // Duplicate — do not dispatch.
        return "";
      }
    }

    const driverSerializes =
      (this.driver as SerializableDriver).serializes === true;
    const { data, serializesModels } = jobPayloadData(job, driverSerializes);
    const delay =
      options.delay !== undefined
        ? options.delay
        : job.delay > 0
          ? job.delay
          : undefined;

    const worker = jobWorkerOptions(job);
    return this.push(job.constructor.name, data, job.queue, {
      maxTries: job.tries,
      delay,
      chain: options.chain ? this.#serializeChain(options.chain) : undefined,
      batchId: options.batchId,
      onChainFailure: options.onChainFailure,
      serializesModels: serializesModels || undefined,
      timeout: worker.timeout,
      backoff: worker.backoff,
      retryUntil: worker.retryUntil,
      maxExceptions: worker.maxExceptions,
    });
  }

  /** Delay a job by the given number of seconds (`Queue::later`). */
  async later(delay: number, job: Job): Promise<string> {
    return this.dispatch(job, { delay });
  }

  /** Process up to `times` jobs from a queue. */
  async work(queue = this.#defaultQueue, times = 1): Promise<number> {
    const { Queue, fireQueueHook } = await import("./queue-fake.ts");
    if (Queue.isPaused(queue)) return 0;

    let ran = 0;
    for (let i = 0; i < times; i++) {
      await fireQueueHook("looping");
      const payload = await this.driver.pop(queue);
      if (!payload) break;
      await fireQueueHook("before", payload);
      try {
        await this.#run(payload, queue);
        await fireQueueHook("after", payload);
      } catch (err) {
        await fireQueueHook("exceptionOccurred", payload, err);
        throw err;
      }
      ran += 1;
    }
    return ran;
  }

  /**
   * Worker loop (`queue:work`).
   * Stops when `signal.aborted` or `once` and the queue is empty.
   */
  async daemon(
    options: {
      queue?: string;
      sleep?: number;
      once?: boolean;
      /** Override default job timeout (seconds) for this worker. */
      timeout?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<number> {
    if (options.timeout !== undefined) {
      this.defaultTimeout = options.timeout;
    }
    const queue = options.queue ?? this.#defaultQueue;
    const sleepMs = options.sleep ?? 1000;
    let total = 0;

    while (!options.signal?.aborted) {
      const ran = await this.work(queue, 1);
      total += ran;
      if (ran === 0) {
        if (options.once) break;
        await Bun.sleep(sleepMs);
      }
    }
    return total;
  }

  async size(queue = this.#defaultQueue): Promise<number> {
    return this.driver.size(queue);
  }

  /** Re-queue a failed job by uuid. */
  async retry(id: string): Promise<boolean> {
    if (!this.#failed) return false;
    const record = await this.#failed.find(id);
    if (!record) return false;
    const payload = record.payload as InternalPayload;
    await this.push(record.payload.name, record.payload.data, record.queue, {
      id: record.payload.id,
      attempts: 0,
      maxTries: payload.maxTries,
      chain: payload.chain,
      batchId: payload.batchId,
      timeout: payload.timeout,
      backoff: payload.backoff,
      retryUntil: payload.retryUntil,
      maxExceptions: payload.maxExceptions,
    });
    await this.#failed.forget(id);
    return true;
  }

  /** Re-queue all failed jobs. */
  async retryAll(): Promise<number> {
    if (!this.#failed) return 0;
    const all = await this.#failed.all();
    let n = 0;
    for (const job of all) {
      if (await this.retry(job.id)) n += 1;
    }
    return n;
  }

  async #run(payload: JobPayload, queue = this.#defaultQueue): Promise<void> {
    const internal = payload as InternalPayload;

    if (internal.batchId) {
      const { isBatchCancelled, recordBatchJobResult } =
        await import("./bus.ts");
      if (await isBatchCancelled(internal.batchId)) {
        await recordBatchJobResult(internal.batchId, payload.id, null);
        return;
      }
    }

    const handler = this.#handlers.get(payload.name);
    if (!handler) {
      throw new Error(`No handler registered for job [${payload.name}].`);
    }

    const maxTries = internal.maxTries ?? this.#tries;
    payload.attempts += 1;

    const data = (await restoreJobFields(
      payload.data,
      payload.serializesModels === true,
    )) as unknown;

    if (isJobInstance(data) && jobImplementsUnique(data) && jobUniqueUntilProcessing(data)) {
      await releaseUniqueJobLock(data);
    }

    /** ShouldBeUnique: release after the job finishes (not on retry/release). */
    const releaseUniqueAfterFinish = async (): Promise<void> => {
      if (
        isJobInstance(data) &&
        jobImplementsUnique(data) &&
        !jobUniqueUntilProcessing(data)
      ) {
        await releaseUniqueJobLock(data);
      }
    };

    const timeoutSeconds =
      isJobInstance(data) && typeof data.timeout === "number"
        ? data.timeout
        : (internal.timeout ?? this.#defaultTimeout ?? 0);
    const backoff =
      isJobInstance(data) && data.backoff !== undefined
        ? data.backoff
        : internal.backoff;
    const retryUntil =
      isJobInstance(data)
        ? resolveRetryUntil(data)
        : (internal.retryUntil ?? null);
    const maxExceptions =
      isJobInstance(data) && data.maxExceptions != null
        ? data.maxExceptions
        : (internal.maxExceptions ?? null);

    const failPermanently = async (error: Error): Promise<void> => {
      const exception = error.stack ?? error.message;
      await releaseUniqueAfterFinish();

      if (internal.onChainFailure) {
        await internal.onChainFailure(error);
      }

      if (internal.batchId) {
        const { recordBatchJobResult } = await import("./bus.ts");
        await recordBatchJobResult(internal.batchId, payload.id, error);
      }

      if (this.#failed) {
        const failedPayload: JobPayload = {
          id: payload.id,
          name: payload.name,
          data: payload.data,
          attempts: payload.attempts,
          chain: internal.chain,
          batchId: internal.batchId,
        };
        await this.#failed.store({
          id: payload.id,
          queue,
          payload: failedPayload,
          exception,
          failedAt: nowSeconds(),
        });
        const { fireQueueHook } = await import("./queue-fake.ts");
        await fireQueueHook("failing", failedPayload, error);
        return;
      }

      throw error;
    };

    try {
      await runWithTimeout(() => handler(data), timeoutSeconds);
      if (isJobInstance(data) && data.isReleased()) {
        // Overlap / rate-limit release: re-queue without consuming an attempt.
        payload.attempts = Math.max(0, payload.attempts - 1);
        await this.driver.push(queue, {
          ...payload,
          maxTries,
          timeout: timeoutSeconds,
          backoff,
          retryUntil,
          maxExceptions,
          availableAt: nowSeconds() + data.releaseDelay(),
        } as InternalPayload);
        return;
      }
      if (isJobInstance(data) && data.isDeleted()) {
        await releaseUniqueAfterFinish();
        return;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const timedOut = error.message === "Job timed out";
      if (
        timedOut &&
        isJobInstance(data) &&
        data.shouldFailOnTimeout()
      ) {
        await failPermanently(error);
        return;
      }

      const exceptions = (internal.exceptions ?? 0) + 1;
      const pastRetryUntil =
        retryUntil != null && nowSeconds() >= retryUntil;
      const pastMaxExceptions =
        maxExceptions != null && exceptions >= maxExceptions;
      const canRetry =
        payload.attempts < maxTries && !pastRetryUntil && !pastMaxExceptions;

      if (canRetry) {
        const delay = resolveBackoff(backoff, payload.attempts);
        await this.driver.push(queue, {
          ...payload,
          maxTries,
          timeout: timeoutSeconds,
          backoff,
          retryUntil,
          maxExceptions,
          exceptions,
          availableAt: delay > 0 ? nowSeconds() + delay : undefined,
        } as InternalPayload);
        return;
      }

      await failPermanently(error);
      return;
    }

    await releaseUniqueAfterFinish();

    // Success — advance chain / batch.
    if (internal.chain && internal.chain.length > 0) {
      const [next, ...rest] = internal.chain;
      const chained = next as ChainedJobPayload & {
        timeout?: number;
        backoff?: number | number[];
        retryUntil?: number | null;
        maxExceptions?: number | null;
      };
      await this.push(next.name, next.data, next.queue ?? queue, {
        maxTries: next.maxTries,
        delay: next.delay,
        chain: rest.length > 0 ? rest : undefined,
        onChainFailure: internal.onChainFailure,
        serializesModels: next.serializesModels,
        timeout: chained.timeout,
        backoff: chained.backoff,
        retryUntil: chained.retryUntil,
        maxExceptions: chained.maxExceptions,
      });
    }

    if (internal.batchId) {
      const { recordBatchJobResult } = await import("./bus.ts");
      await recordBatchJobResult(internal.batchId, payload.id, null);
    }
  }
}

let defaultQueue: QueueManager | undefined;

export function setQueue(manager: QueueManager): void {
  defaultQueue = manager;
}

export function getQueue(): QueueManager {
  return defaultQueue!;
}

/** `dispatch($job)` — returns a pending builder (thenable). */
export function dispatch(job: Job): PendingDispatch {
  return new PendingDispatch(job);
}
