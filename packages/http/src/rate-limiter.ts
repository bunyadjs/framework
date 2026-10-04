import type { Request } from "./request.ts";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets when blocked; 0 when allowed. */
  retryAfter: number;
  resetAt: number;
};

/**
 * Sliding-window counter state. The effective hit count is the current
 * window's hits plus the previous window's hits weighted by how much of that
 * window still overlaps the trailing `window` ms.
 */
type Bucket = {
  /** Hits in the current window. */
  count: number;
  /** Hits in the window before the current one. */
  previous: number;
  /** Current window start (ms). */
  start: number;
  /** Window length (ms). */
  window: number;
  /** Last finite limit used, so `availableIn(key)` can work without it. */
  max?: number;
};

const EPSILON = 1e-9;

/** Roll the window forward so `start <= now < start + window`. */
function slide(
  bucket: Bucket | undefined,
  now: number,
  window: number,
): Bucket {
  if (!bucket || bucket.window !== window) {
    return { count: 0, previous: 0, start: now, window };
  }
  const elapsed = now - bucket.start;
  if (elapsed >= window * 2) {
    return { count: 0, previous: 0, start: now, window, max: bucket.max };
  }
  if (elapsed >= window) {
    return {
      count: 0,
      previous: bucket.count,
      start: bucket.start + window,
      window,
      max: bucket.max,
    };
  }
  return bucket;
}

/** Weighted hit count over the trailing window. */
function estimate(bucket: Bucket, now: number): number {
  const elapsed = Math.min(bucket.window, Math.max(0, now - bucket.start));
  return bucket.previous * (1 - elapsed / bucket.window) + bucket.count;
}

/** Whether one more hit would exceed `max`. */
function isFull(bucket: Bucket, now: number, max: number): boolean {
  return estimate(bucket, now) + 1 > max + EPSILON;
}

/** Milliseconds until one more hit would fit under `max`. */
function waitMs(bucket: Bucket, now: number, max: number): number {
  const { count, previous, window } = bucket;
  const elapsed = now - bucket.start;
  const room = max - count - 1;
  if (room >= 0) {
    if (previous <= 0) return 0;
    return Math.max(0, window * (1 - room / previous) - elapsed);
  }
  // Current window is full: wait for it to roll, then for its weight to decay.
  if (max < 1) return window * 2 - elapsed;
  return window - elapsed + window * (1 - (max - 1) / count);
}

/** Milliseconds until the key holds no weight at all. */
function clearMs(bucket: Bucket, now: number): number {
  const elapsed = now - bucket.start;
  if (bucket.count > 0) return bucket.window * 2 - elapsed;
  if (bucket.previous > 0) return bucket.window - elapsed;
  return 0;
}

/** Hit count as shown to callers (rounded up, never under-reports). */
function attemptsOf(bucket: Bucket, now: number): number {
  return Math.max(0, Math.ceil(estimate(bucket, now) - EPSILON));
}

/**
 * Minimal cache surface for multi-worker rate limiting.
 * Satisfied by `@bunyad/cache` CacheRepository / MemoryCacheStore.
 */
export type RateLimiterCache = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown, seconds?: number): Promise<void>;
  forget(key: string): Promise<boolean>;
};

/**
 * `Limit::perMinute(60)->by($key)`.
 */
export class Limit {
  key = "";
  #unlimited = false;
  #responseFactory?: (result: RateLimitResult) => Response;
  #afterPredicate?: (response: Response) => boolean;

  constructor(
    readonly maxAttempts: number,
    readonly decaySeconds: number,
  ) {}

  static perMinute(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 60);
  }

  static perSeconds(maxAttempts: number, seconds: number): Limit {
    return new Limit(maxAttempts, seconds);
  }

  static perHour(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 3600);
  }

  static perDay(maxAttempts: number): Limit {
    return new Limit(maxAttempts, 86_400);
  }

  /** Unlimited named limiter (skip enforcement). */
  static none(): Limit {
    const limit = new Limit(Number.POSITIVE_INFINITY, 60);
    limit.#unlimited = true;
    return limit;
  }

  /** Authenticated API routes: 60/min by user id or IP. */
  static api(request: Request): Limit {
    const user = request.user as { id?: string | number } | undefined;
    return Limit.perMinute(60).by(user?.id ?? request.ip());
  }

  /** Login / register attempts: 5/min by IP (apply to POST only, not form GETs). */
  static auth(request: Request): Limit {
    return Limit.perMinute(5).by(request.ip());
  }

  /** Token endpoints: 10/hour by IP. */
  static tokens(request: Request): Limit {
    return Limit.perHour(10).by(request.ip());
  }

  by(key: string | number): this {
    this.key = String(key);
    return this;
  }

  /** Custom 429 response builder. */
  response(factory: (result: RateLimitResult) => Response): this {
    this.#responseFactory = factory;
    return this;
  }

  /** Only count the attempt when the response matches. */
  after(predicate: (response: Response) => boolean): this {
    this.#afterPredicate = predicate;
    return this;
  }

  isUnlimited(): boolean {
    return this.#unlimited;
  }

  responseFactory(): ((result: RateLimitResult) => Response) | undefined {
    return this.#responseFactory;
  }

  afterPredicate(): ((response: Response) => boolean) | undefined {
    return this.#afterPredicate;
  }
}

export type NamedLimiter = (
  /** HTTP `Request` or a queue `Job`; annotate the one you use. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
) => Limit | Limit[] | Promise<Limit | Limit[]>;

const CACHE_PREFIX = "bunyad:rate:";

/**
 * Sliding-window rate limiter (weighted two-window counter), so a client can
 * not burst `2 × max` across a window boundary.
 * Uses an in-process Map by default; call `use(cache)` to share via Cache.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #named = new Map<string, NamedLimiter>();
  #cache: RateLimiterCache | undefined;

  /** Back the limiter with Cache so workers share counters. */
  use(cache: RateLimiterCache | undefined): this {
    this.#cache = cache;
    return this;
  }

  /** Register a named limiter (`RateLimiter::for('api', ...)`). */
  for(name: string, callback: NamedLimiter): this {
    this.#named.set(name, callback);
    return this;
  }

  limiter(name: string): NamedLimiter | undefined {
    return this.#named.get(name);
  }

  /**
   * Record a hit. Returns whether the request is allowed.
   * Async when a cache backend is configured.
   *
   * Callback form: `attempt(key, max, callback, decaySeconds?)` runs the
   * callback only when the attempt is allowed (skips the hit when exhausted).
   */
  attempt(
    key: string,
    maxAttempts: number,
    decaySecondsOrCallback?: number | (() => unknown | Promise<unknown>),
    decaySeconds = 60,
  ): RateLimitResult | Promise<RateLimitResult | unknown> {
    if (typeof decaySecondsOrCallback === "function") {
      const callback = decaySecondsOrCallback;
      const decay = decaySeconds;
      const run = async () => {
        const peek = await Promise.resolve(
          this.tooManyAttempts(key, maxAttempts),
        );
        if (peek) {
          const retryAfter = await Promise.resolve(this.availableIn(key, maxAttempts));
          return {
            allowed: false,
            limit: maxAttempts,
            remaining: 0,
            retryAfter,
            resetAt: Math.floor(Date.now() / 1000) + retryAfter,
          } satisfies RateLimitResult;
        }
        await Promise.resolve(this.#hit(key, maxAttempts, decay));
        return callback();
      };
      return run();
    }
    const decay =
      typeof decaySecondsOrCallback === "number"
        ? decaySecondsOrCallback
        : 60;
    return this.#hit(key, maxAttempts, decay);
  }

  #hit(
    key: string,
    maxAttempts: number,
    decaySeconds: number,
  ): RateLimitResult | Promise<RateLimitResult> {
    if (this.#cache) {
      return this.#attemptCache(key, maxAttempts, decaySeconds);
    }
    return this.#attemptMemory(key, maxAttempts, decaySeconds);
  }

  /** Record a hit on `bucket`; a blocked hit is not counted. */
  #record(
    stored: Bucket | undefined,
    maxAttempts: number,
    decaySeconds: number,
    now: number,
  ): { bucket: Bucket; result: RateLimitResult } {
    const bucket = slide(stored, now, decaySeconds * 1000);
    if (Number.isFinite(maxAttempts) && maxAttempts < Number.MAX_SAFE_INTEGER) {
      bucket.max = maxAttempts;
    }

    if (isFull(bucket, now, maxAttempts)) {
      const wait = waitMs(bucket, now, maxAttempts);
      return {
        bucket,
        result: {
          allowed: false,
          limit: maxAttempts,
          remaining: 0,
          retryAfter: Math.max(1, Math.ceil(wait / 1000)),
          resetAt: now + wait,
        },
      };
    }

    bucket.count += 1;
    return {
      bucket,
      result: {
        allowed: true,
        limit: maxAttempts,
        remaining: Math.max(
          0,
          Math.floor(maxAttempts - estimate(bucket, now) + EPSILON),
        ),
        retryAfter: 0,
        resetAt: bucket.start + bucket.window,
      },
    };
  }

  #attemptMemory(
    key: string,
    maxAttempts: number,
    decaySeconds: number,
  ): RateLimitResult {
    const { bucket, result } = this.#record(
      this.#buckets.get(key),
      maxAttempts,
      decaySeconds,
      Date.now(),
    );
    this.#buckets.set(key, bucket);
    return result;
  }

  async #attemptCache(
    key: string,
    maxAttempts: number,
    decaySeconds: number,
  ): Promise<RateLimitResult> {
    const cache = this.#cache!;
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const { bucket, result } = this.#record(
      await cache.get<Bucket>(cacheKey),
      maxAttempts,
      decaySeconds,
      Date.now(),
    );
    // A bucket stays relevant for two windows before it carries no weight.
    await cache.put(cacheKey, bucket, Math.ceil(decaySeconds * 2));
    return result;
  }

  /** Read the live bucket for a key (memory or cache), rolled to `now`. */
  #peek<T>(key: string, read: (bucket: Bucket | undefined, now: number) => T): T | Promise<T> {
    if (this.#cache) {
      return this.#cache
        .get<Bucket>(`${CACHE_PREFIX}${key}`)
        .then((bucket) => read(this.#live(bucket), Date.now()));
    }
    return read(this.#live(this.#buckets.get(key)), Date.now());
  }

  #live(bucket: Bucket | undefined): Bucket | undefined {
    return bucket ? slide(bucket, Date.now(), bucket.window) : undefined;
  }

  /** Evaluate a named limiter against the request. */
  async attemptNamed(
    name: string,
    request: Request,
  ): Promise<RateLimitResult> {
    const callback = this.#named.get(name);
    if (!callback) {
      throw new Error(`Rate limiter [${name}] is not defined.`);
    }
    const raw = await callback(request);
    const limits = Array.isArray(raw) ? raw : [raw];

    let worst: RateLimitResult | undefined;
    for (const limit of limits) {
      if (limit.isUnlimited()) {
        const unlimited: RateLimitResult = {
          allowed: true,
          limit: Number.POSITIVE_INFINITY,
          remaining: Number.POSITIVE_INFINITY,
          retryAfter: 0,
          resetAt: Math.floor(Date.now() / 1000) + 60,
        };
        if (!worst) worst = unlimited;
        continue;
      }
      const key = `named:${name}:${limit.key || request.ip()}`;
      const result = (await this.attempt(
        key,
        limit.maxAttempts,
        limit.decaySeconds,
      )) as RateLimitResult;
      if (!worst || !result.allowed || result.remaining < worst.remaining) {
        worst = result;
      }
      if (!result.allowed) return result;
    }
    return (
      worst ?? {
        allowed: true,
        limit: Number.POSITIVE_INFINITY,
        remaining: Number.POSITIVE_INFINITY,
        retryAfter: 0,
        resetAt: Math.floor(Date.now() / 1000) + 60,
      }
    );
  }

  tooManyAttempts(
    key: string,
    maxAttempts: number,
  ): boolean | Promise<boolean> {
    return this.#peek(key, (bucket, now) =>
      bucket ? isFull(bucket, now, maxAttempts) : false,
    );
  }

  /** Hits recorded for a key. */
  attempts(key: string): number | Promise<number> {
    return this.#peek(key, (bucket, now) =>
      bucket ? attemptsOf(bucket, now) : 0,
    );
  }

  /** Remaining attempts. */
  remaining(
    key: string,
    maxAttempts: number,
  ): number | Promise<number> {
    const n = this.attempts(key);
    if (n instanceof Promise) {
      return n.then((count) => Math.max(0, maxAttempts - count));
    }
    return Math.max(0, maxAttempts - n);
  }

  retriesLeft(
    key: string,
    maxAttempts: number,
  ): number | Promise<number> {
    return this.remaining(key, maxAttempts);
  }

  /** Unix timestamp (seconds) when the lockout ends. */
  availableAt(
    key: string,
    maxAttempts?: number,
  ): number | Promise<number> {
    const seconds = this.availableIn(key, maxAttempts);
    const at = (s: number) => Math.floor(Date.now() / 1000) + s;
    return seconds instanceof Promise ? seconds.then(at) : at(seconds);
  }

  /**
   * Seconds until another hit would be allowed under `maxAttempts`.
   * Without it, falls back to the last limit used on the key, then to the time
   * until the key has no weight left.
   */
  availableIn(
    key: string,
    maxAttempts?: number,
  ): number | Promise<number> {
    return this.#peek(key, (bucket, now) => {
      if (!bucket) return 0;
      const max = maxAttempts ?? bucket.max;
      const ms =
        max === undefined ? clearMs(bucket, now) : waitMs(bucket, now, max);
      return ms <= 0 ? 0 : Math.max(1, Math.ceil(ms / 1000));
    });
  }

  /** Record a hit and return the new attempt count. */
  hit(
    key: string,
    decaySeconds = 60,
  ): number | Promise<number> {
    const result = this.attempt(key, Number.MAX_SAFE_INTEGER, decaySeconds);
    if (result instanceof Promise) {
      return result.then(() => this.attempts(key) as Promise<number>);
    }
    return this.attempts(key) as number;
  }

  /** Increment hit count. */
  increment(
    key: string,
    decaySeconds = 60,
    amount = 1,
  ): number | Promise<number> {
    if (this.#cache) {
      return (async () => {
        let last = 0;
        for (let i = 0; i < amount; i++) {
          last = (await this.hit(key, decaySeconds)) as number;
        }
        return last;
      })();
    }
    let last = 0;
    for (let i = 0; i < amount; i++) {
      last = this.hit(key, decaySeconds) as number;
    }
    return last;
  }

  /** Decrement hit count. */
  decrement(
    key: string,
    amount = 1,
  ): number | Promise<number> {
    const apply = (bucket: Bucket | undefined): Bucket | undefined => {
      if (!bucket) return undefined;
      const live = slide(bucket, Date.now(), bucket.window);
      live.count = Math.max(0, live.count - amount);
      return live;
    };
    if (this.#cache) {
      return (async () => {
        const cacheKey = `${CACHE_PREFIX}${key}`;
        const bucket = apply(await this.#cache!.get<Bucket>(cacheKey));
        if (!bucket) return 0;
        await this.#cache!.put(cacheKey, bucket, Math.ceil(bucket.window / 500));
        return attemptsOf(bucket, Date.now());
      })();
    }
    const bucket = apply(this.#buckets.get(key));
    if (!bucket) return 0;
    this.#buckets.set(key, bucket);
    return attemptsOf(bucket, Date.now());
  }

  /** Reset attempts for a key. */
  resetAttempts(key: string): void | Promise<void> {
    return this.clear(key);
  }

  /** Normalize a limiter key. */
  cleanRateLimiterKey(key: string): string {
    return key.replace(/&/g, "").replace(/:/g, "").slice(0, 200);
  }

  clear(key: string): void | Promise<void> {
    this.#buckets.delete(key);
    if (this.#cache) {
      return this.#cache.forget(`${CACHE_PREFIX}${key}`).then(() => undefined);
    }
  }

  flush(): void | Promise<void> {
    this.#buckets.clear();
  }

  /** No-op on the in-memory limiter (cache driver serialization N/A). */
  withoutSerializationOrCompression(): this {
    return this;
  }
}

let defaultLimiter: RateLimiter | undefined;

export function setRateLimiter(limiter: RateLimiter): void {
  defaultLimiter = limiter;
}

export function getRateLimiter(): RateLimiter {
  return defaultLimiter ?? (defaultLimiter = new RateLimiter());
}

/** Register named limiters (`api`, `auth`, `tokens`). */
export function registerRateLimitPresets(limiter: RateLimiter): void {
  limiter.for("api", (ctx) => Limit.api(ctx as Request));
  limiter.for("auth", (ctx) => Limit.auth(ctx as Request));
  limiter.for("tokens", (ctx) => Limit.tokens(ctx as Request));
}
