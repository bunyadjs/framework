import type { Job } from "./job.ts";
import { cache } from "@bunyad/cache";
import { getRateLimiter, Limit } from "@bunyad/http";

export type JobMiddlewareNext = () => void | Promise<void>;

/**
 * Job middleware — class with `handle($job, $next)` or a function.
 */
export type JobMiddleware =
  | {
      handle(job: Job, next: JobMiddlewareNext): void | Promise<void>;
    }
  | ((job: Job, next: JobMiddlewareNext) => void | Promise<void>);

function isJobLike(value: unknown): value is Job {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as Job).handle === "function"
  );
}

/** Run `middleware()` stack then `handle()`. */
export async function runJob(job: Job): Promise<void> {
  const raw =
    typeof (job as Job & { middleware?: () => JobMiddleware[] }).middleware ===
    "function"
      ? (job as Job & { middleware: () => JobMiddleware[] }).middleware()
      : [];
  const stack = Array.isArray(raw) ? raw : [];

  let index = -1;
  const dispatch = async (i: number): Promise<void> => {
    if (i <= index) {
      throw new Error("Job middleware next() called multiple times.");
    }
    index = i;
    if (i === stack.length) {
      await job.handle();
      return;
    }
    const layer = stack[i]!;
    const next: JobMiddlewareNext = () => dispatch(i + 1);
    if (typeof layer === "function") {
      await layer(job, next);
    } else {
      await layer.handle(job, next);
    }
  };

  await dispatch(0);
}

/** True when `data` is a Job instance (not a plain named-handler payload). */
export function isJobInstance(data: unknown): data is Job {
  return isJobLike(data);
}

/**
 * `WithoutOverlapping` job middleware.
 * Uses `Cache.add` as a lock (SET-if-absent).
 */
export class WithoutOverlapping {
  #key: string;
  #releaseAfter = 0;
  #expiresAfter = 86400;
  #prefix = "bunyad-queue-overlap:";
  #shouldRelease = true;

  constructor(key: string | number = "") {
    this.#key = String(key);
  }

  /** Seconds to delay when the lock is held (`releaseAfter`). */
  releaseAfter(seconds: number): this {
    this.#releaseAfter = seconds;
    this.#shouldRelease = true;
    return this;
  }

  /** Drop the job when overlapping instead of releasing (`dontRelease`). */
  dontRelease(): this {
    this.#shouldRelease = false;
    return this;
  }

  /** Lock TTL in seconds (`expireAfter`). */
  expireAfter(seconds: number): this {
    this.#expiresAfter = seconds;
    return this;
  }

  /** Lock key prefix (`withPrefix`). */
  withPrefix(prefix: string): this {
    this.#prefix = prefix;
    return this;
  }

  #lockKey(job: Job): string {
    const suffix = this.#key.length > 0 ? this.#key : job.constructor.name;
    return `${this.#prefix}${suffix}`;
  }

  async handle(job: Job, next: JobMiddlewareNext): Promise<void> {
    const key = this.#lockKey(job);
    const owner = job.uuid();
    const acquired = await cache().add(key, owner, this.#expiresAfter);
    if (!acquired) {
      if (this.#shouldRelease) {
        job.release(this.#releaseAfter);
      }
      return;
    }
    try {
      await next();
    } finally {
      const current = await cache().get(key);
      if (current === owner) {
        await cache().forget(key);
      }
    }
  }
}

/**
 * `RateLimited` job middleware.
 * Uses named `RateLimiter::for` limiters (job passed as context) or
 * `Limit.perMinute` via {@link RateLimited.using}.
 */
export class RateLimited {
  #limiterName: string | null;
  #limitFactory: ((job: Job) => Limit | Limit[] | Promise<Limit | Limit[]>) | null =
    null;
  #shouldRelease = true;

  constructor(limiterName = "") {
    this.#limiterName = limiterName.length > 0 ? limiterName : null;
  }

  /** Inline limit factory when no named limiter is registered. */
  using(
    factory: (job: Job) => Limit | Limit[] | Promise<Limit | Limit[]>,
  ): this {
    this.#limitFactory = factory;
    return this;
  }

  dontRelease(): this {
    this.#shouldRelease = false;
    return this;
  }

  async handle(job: Job, next: JobMiddlewareNext): Promise<void> {
    const limiter = getRateLimiter();
    let limits: Limit[];

    if (this.#limitFactory) {
      const raw = await this.#limitFactory(job);
      limits = Array.isArray(raw) ? raw : [raw];
    } else if (this.#limiterName) {
      const named = limiter.limiter(this.#limiterName);
      if (!named) {
        throw new Error(
          `Rate limiter [${this.#limiterName}] is not defined.`,
        );
      }
      // Named limiters may be HTTP Request-oriented; pass the job as context.
      const raw = await named(job as never);
      limits = Array.isArray(raw) ? raw : [raw];
    } else {
      throw new Error(
        "RateLimited requires a limiter name or using() factory.",
      );
    }

    for (const limit of limits) {
      const key = `job:${this.#limiterName ?? "inline"}:${limit.key || job.constructor.name}`;
      if (await limiter.tooManyAttempts(key, limit.maxAttempts)) {
        if (this.#shouldRelease) {
          job.release((await limiter.availableIn(key, limit.maxAttempts)) || 1);
        }
        return;
      }
      await limiter.hit(key, limit.decaySeconds);
    }

    await next();
  }
}

export { Limit };
