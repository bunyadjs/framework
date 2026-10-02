/**
 * `ShouldQueue` marker — Job subclasses are queueable via the active
 * connection (sync runs immediately; memory/database/redis defer to workers).
 */
export interface ShouldQueue {}

/**
 * Base class for queue jobs.
 */
export abstract class Job implements ShouldQueue {
  /** Queue name. */
  queue = "default";

  /**
   * Queue connection name.
   * When set, dispatch uses `Queue.connection(name)` if configured.
   */
  connection: string | null = null;

  /** Max attempts before failing (`$tries`). */
  tries = 1;

  /**
   * Delay in seconds before the job is available to workers (`$delay`).
   * Ignored by the sync driver (runs immediately).
   */
  delay = 0;

  /** Job timeout in seconds. `0` disables the worker timeout. */
  timeout = 60;

  /** Backoff seconds (or list) between retries. */
  backoff: number | number[] = 0;

  /**
   * Stop retrying after this unix timestamp.
   * Prefer overriding {@link retryUntil} when the deadline is computed at runtime.
   */
  retryUntilTimestamp: number | null = null;

  /** Max unhandled exceptions before failing permanently. */
  maxExceptions: number | null = null;

  /**
   * Unix timestamp (or `Date`) after which the worker must not retry this job.
   * Override in subclasses, or set {@link retryUntilTimestamp}.
   */
  retryUntil(): number | Date | null {
    return this.retryUntilTimestamp;
  }

  /**
   * Dispatch only after the active DB transaction commits (`$afterCommit`).
   * When not in a transaction, dispatches immediately.
   */
  afterCommit = false;

  #uuid = crypto.randomUUID();
  #deleted = false;
  #released = false;
  #failed = false;
  #releaseDelay = 0;

  /** Unique job type name (defaults to constructor name). */
  get name(): string {
    return this.constructor.name;
  }

  getName(): string {
    return this.name;
  }

  /** Alias of {@link tries}. */
  get maxTries(): number {
    return this.tries;
  }

  set maxTries(value: number) {
    this.tries = value;
  }

  uuid(): string {
    return this.#uuid;
  }

  getJobId(): string {
    return this.#uuid;
  }

  payload(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      out[key] = (this as Record<string, unknown>)[key];
    }
    return out;
  }

  delete(): void {
    this.#deleted = true;
  }

  isDeleted(): boolean {
    return this.#deleted;
  }

  release(delay = 0): void {
    this.#released = true;
    this.#releaseDelay = delay;
  }

  isReleased(): boolean {
    return this.#released;
  }

  isDeletedOrReleased(): boolean {
    return this.#deleted || this.#released;
  }

  releaseDelay(): number {
    return this.#releaseDelay;
  }

  fail(_error?: Error): void {
    this.#failed = true;
  }

  markAsFailed(): void {
    this.#failed = true;
  }

  hasFailed(): boolean {
    return this.#failed;
  }

  /** Optional failure hook. */
  failed?(_error: Error): void | Promise<void>;

  shouldFailOnTimeout(): boolean {
    return false;
  }

  /**
   * `middleware()` — job middleware stack run around `handle()`.
   * Override to return `WithoutOverlapping` / `RateLimited` / custom layers.
   */
  middleware(): import("./middleware.ts").JobMiddleware[] {
    return [];
  }

  abstract handle(): void | Promise<void>;
}
