import type { Job } from "./job.ts";
import { getQueue } from "./manager.ts";
import {
  markExplicitConnection,
  markExplicitQueue,
} from "./queue-routes.ts";

/**
 * Fluent dispatch builder (`dispatch($job)->delay(...)->chain([...])`).
 * Sends on the next microtask so chained configuration in the same tick applies.
 * Also thenable so `await dispatch(job)` still works.
 */
export class PendingDispatch implements PromiseLike<string> {
  readonly #job: Job;
  #chain: Job[] = [];
  #delay?: number;
  #promise?: Promise<string>;
  #afterResponse = false;
  #afterCommit = false;

  constructor(job: Job) {
    this.#job = job;
    if (job.afterCommit) {
      this.#afterCommit = true;
      void import("@bunyad/database").then(({ afterCommit }) => {
        afterCommit(() => {
          void this.#send();
        });
      });
      return;
    }
    queueMicrotask(() => {
      if (this.#afterResponse || this.#afterCommit || this.#promise) return;
      void this.#send();
    });
  }

  /** Delay availability by the given number of seconds. */
  delay(seconds: number): this {
    this.#delay = seconds;
    this.#job.delay = seconds;
    return this;
  }

  /** Set the queue name for this job. */
  onQueue(queue: string): this {
    this.#job.queue = queue;
    markExplicitQueue(this.#job);
    return this;
  }

  /** Set the queue connection (Laravel `onConnection`). */
  onConnection(connection: string): this {
    this.#job.connection = connection;
    markExplicitConnection(this.#job);
    return this;
  }

  /** Append jobs to run after this one succeeds. */
  chain(jobs: Job[]): this {
    this.#chain = jobs;
    return this;
  }

  /**
   * Dispatch after the current turn (Laravel `afterResponse`).
   * Uses a macrotask so the HTTP response can finish first.
   */
  afterResponse(): this {
    this.#afterResponse = true;
    setTimeout(() => {
      void this.#send();
    }, 0);
    return this;
  }

  /**
   * Dispatch after the outermost DB transaction commits (Laravel `afterCommit`).
   * Runs immediately when no transaction is active.
   */
  afterCommit(): this {
    this.#afterCommit = true;
    this.#job.afterCommit = true;
    // Defer send to afterCommit hook instead of microtask.
    void import("@bunyad/database").then(({ afterCommit }) => {
      afterCommit(() => {
        void this.#send();
      });
    });
    return this;
  }

  then<TResult1 = string, TResult2 = never>(
    onfulfilled?:
      | ((value: string) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#send().then(onfulfilled, onrejected);
  }

  #send(): Promise<string> {
    if (this.#promise) return this.#promise;
    this.#promise = getQueue().dispatch(this.#job, {
      chain: this.#chain,
      delay: this.#delay,
    });
    return this.#promise;
  }
}
