import type { Request } from "./request.ts";

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets when blocked; 0 when allowed. */
  retryAfter: number;
  resetAt: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

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
 * Fixed-window rate limiter.
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
          const retryAfter = await Promise.resolve(this.availableIn(key));
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

  #attemptMemory(
    key: string,
    maxAttempts: number,
    decaySeconds: number,
  ): RateLimitResult {
    const now = Date.now();
    let bucket = this.#buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + decaySeconds * 1000 };
      this.#buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, maxAttempts - bucket.count);
    const allowed = bucket.count <= maxAttempts;
    const retryAfter = allowed
      ? 0
      : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    return {
      allowed,
      limit: maxAttempts,
      remaining: allowed ? remaining : 0,
      retryAfter,
      resetAt: bucket.resetAt,
    };
  }

  async #attemptCache(
    key: string,
    maxAttempts: number,
    decaySeconds: number,
  ): Promise<RateLimitResult> {
    const cache = this.#cache!;
    const cacheKey = `${CACHE_PREFIX}${key}`;
    const now = Date.now();
    let bucket = await cache.get<Bucket>(cacheKey);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + decaySeconds * 1000 };
    }

    bucket = { ...bucket, count: bucket.count + 1 };
    const ttlSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    await cache.put(cacheKey, bucket, ttlSeconds);

    const remaining = Math.max(0, maxAttempts - bucket.count);
    const allowed = bucket.count <= maxAttempts;
    const retryAfter = allowed
      ? 0
      : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    return {
      allowed,
      limit: maxAttempts,
      remaining: allowed ? remaining : 0,
      retryAfter,
      resetAt: bucket.resetAt,
    };
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
    if (this.#cache) {
      return Promise.resolve(this.attempts(key)).then(
        (n) => n >= maxAttempts,
      );
    }
    const bucket = this.#buckets.get(key);
    if (!bucket || Date.now() >= bucket.resetAt) return false;
    return bucket.count >= maxAttempts;
  }

  /** Hits recorded for a key. */
  attempts(key: string): number | Promise<number> {
    if (this.#cache) {
      return this.#cache.get<Bucket>(`${CACHE_PREFIX}${key}`).then((bucket) => {
        if (!bucket || Date.now() >= bucket.resetAt) return 0;
        return bucket.count;
      });
    }
    const bucket = this.#buckets.get(key);
    if (!bucket || Date.now() >= bucket.resetAt) return 0;
    return bucket.count;
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

  /** Unix timestamp when the lockout ends. */
  availableAt(key: string): number | Promise<number> {
    if (this.#cache) {
      return this.#cache.get<Bucket>(`${CACHE_PREFIX}${key}`).then((bucket) => {
        if (!bucket || Date.now() >= bucket.resetAt) {
          return Math.floor(Date.now() / 1000);
        }
        return Math.ceil(bucket.resetAt / 1000);
      });
    }
    const bucket = this.#buckets.get(key);
    if (!bucket || Date.now() >= bucket.resetAt) {
      return Math.floor(Date.now() / 1000);
    }
    return Math.ceil(bucket.resetAt / 1000);
  }

  /** Seconds until available. */
  availableIn(key: string): number | Promise<number> {
    if (this.#cache) {
      return this.#cache.get<Bucket>(`${CACHE_PREFIX}${key}`).then((bucket) => {
        if (!bucket || Date.now() >= bucket.resetAt) return 0;
        return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
      });
    }
    const bucket = this.#buckets.get(key);
    if (!bucket || Date.now() >= bucket.resetAt) return 0;
    return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
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
    if (this.#cache) {
      return (async () => {
        const cacheKey = `${CACHE_PREFIX}${key}`;
        const bucket = await this.#cache!.get<Bucket>(cacheKey);
        if (!bucket || Date.now() >= bucket.resetAt) return 0;
        bucket.count = Math.max(0, bucket.count - amount);
        const ttl = Math.max(
          1,
          Math.ceil((bucket.resetAt - Date.now()) / 1000),
        );
        await this.#cache!.put(cacheKey, bucket, ttl);
        return bucket.count;
      })();
    }
    const bucket = this.#buckets.get(key);
    if (!bucket || Date.now() >= bucket.resetAt) return 0;
    bucket.count = Math.max(0, bucket.count - amount);
    return bucket.count;
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
