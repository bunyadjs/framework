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
 * The cache surface the limiter counts in; a `@bunyad/cache` repository fits. Counting uses `add` and
 * `increment`, which are atomic, so several workers share one count.
 */
export type RateLimiterCache = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown, seconds?: number): Promise<void>;
  add(key: string, value: unknown, seconds?: number): Promise<boolean>;
  increment(key: string, value?: number): Promise<number>;
  forget(key: string): Promise<boolean>;
};

type MaybePromise<T> = T | Promise<T>;

/** Run `next` on a value that may still be a promise, staying synchronous when it is not. */
function then<T, R>(
  value: MaybePromise<T>,
  next: (value: T) => MaybePromise<R>,
): MaybePromise<R> {
  return value instanceof Promise ? value.then(next) : next(value);
}

/** The counters used when no cache is bound: a Map whose entries expire. */
class LocalCounters {
  readonly #entries = new Map<string, { value: number; expires: number }>();
  #writes = 0;

  #live(key: string): { value: number; expires: number } | undefined {
    const entry = this.#entries.get(key);
    if (entry && entry.expires <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Drop expired entries every so often, so keys that are never asked for again do not pile up. */
  #sweep(): void {
    if (++this.#writes % 1000 !== 0) return;
    const now = Date.now();
    for (const [key, entry] of this.#entries)
      if (entry.expires <= now) this.#entries.delete(key);
  }

  get(key: string): number | undefined {
    return this.#live(key)?.value;
  }

  put(key: string, value: number, seconds: number): void {
    this.#entries.set(key, { value, expires: Date.now() + seconds * 1000 });
    this.#sweep();
  }

  add(key: string, value: number, seconds: number): boolean {
    if (this.#live(key)) return false;
    this.put(key, value, seconds);
    return true;
  }

  increment(key: string, amount = 1): number {
    const entry = this.#live(key);
    if (!entry) {
      this.put(key, amount, 60);
      return amount;
    }
    entry.value += amount;
    return entry.value;
  }

  forget(key: string): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}

/**
 * `Limit.perMinute(60).by(key)`: how many attempts a key gets in a period.
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

  /** The key this limit counts under (`Limit.perMinute(60).by(request.ip())`). */
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
const TIMER = ":timer";

const nowSeconds = (): number => Date.now() / 1000;

/**
 * Fixed-window rate limiter. A key's count lives in a cache with the window as its time to live, next
 * to a timer that says when the window ends; a hit adds the key if it is new and then increments it,
 * both atomically, so workers sharing a cache share one count. Without a cache the same counters are
 * kept in this process. Call `use(cache)` to share them.
 */
export class RateLimiter {
  readonly #local = new LocalCounters();
  readonly #named = new Map<string, NamedLimiter>();
  #cache: RateLimiterCache | undefined;

  /** Count in a shared cache so workers agree. */
  use(cache: RateLimiterCache | undefined): this {
    this.#cache = cache;
    return this;
  }

  /** The counters in use: the cache when bound, else this process. */
  get #store() {
    const cache = this.#cache;
    if (cache) {
      return {
        get: (key: string) => cache.get<number>(CACHE_PREFIX + key),
        put: (key: string, value: number, seconds: number) =>
          cache.put(CACHE_PREFIX + key, value, seconds),
        add: (key: string, value: number, seconds: number) =>
          cache.add(CACHE_PREFIX + key, value, seconds),
        increment: (key: string, amount?: number) =>
          cache.increment(CACHE_PREFIX + key, amount),
        forget: (key: string) => cache.forget(CACHE_PREFIX + key),
      };
    }
    const local = this.#local;
    return {
      get: (key: string) => local.get(key),
      put: (key: string, value: number, seconds: number) =>
        local.put(key, value, seconds),
      add: (key: string, value: number, seconds: number) =>
        local.add(key, value, seconds),
      increment: (key: string, amount?: number) => local.increment(key, amount),
      forget: (key: string) => local.forget(key),
    };
  }

  /** Register a named limiter: `limiter.for("api", (request) => Limit.perMinute(60).by(request.ip()))`. */
  for(name: string, callback: NamedLimiter): this {
    this.#named.set(name, callback);
    return this;
  }

  limiter(name: string): NamedLimiter | undefined {
    return this.#named.get(name);
  }

  /** Whether the key has used up `maxAttempts` in the current window. A spent window is cleared. */
  tooManyAttempts(key: string, maxAttempts: number): MaybePromise<boolean> {
    const store = this.#store;
    return then(this.attempts(key), (attempts) => {
      if (attempts < maxAttempts) return false;
      return then(store.get(key + TIMER), (timer) => {
        if (timer !== undefined) return true;
        return then(this.resetAttempts(key), () => false);
      });
    });
  }

  /** Record a hit and return the new attempt count. */
  hit(key: string, decaySeconds = 60): MaybePromise<number> {
    return this.increment(key, decaySeconds, 1);
  }

  /**
   * Add `amount` to the key's attempts, starting a window when the key is new. A new key is added with
   * its first value in one step, so requests that start a window together cannot overwrite each
   * other's hits.
   */
  increment(key: string, decaySeconds = 60, amount = 1): MaybePromise<number> {
    const store = this.#store;
    return then(
      store.add(key + TIMER, nowSeconds() + decaySeconds, decaySeconds),
      () =>
        then(store.add(key, amount, decaySeconds), (added) => {
          if (added) return amount;
          return then(store.increment(key, amount), (hits) =>
            // the window ended between the two calls and the cache made a key with no expiry: give it one
            hits === amount
              ? then(store.put(key, amount, decaySeconds), () => hits)
              : hits,
          );
        }),
    );
  }

  /** Take `amount` off the key's attempts. */
  decrement(key: string, amount = 1): MaybePromise<number> {
    return this.#store.increment(key, -amount);
  }

  /** Hits recorded for a key in the current window. */
  attempts(key: string): MaybePromise<number> {
    return then(this.#store.get(key), (value) => Number(value ?? 0));
  }

  /** Remaining attempts. */
  remaining(key: string, maxAttempts: number): MaybePromise<number> {
    return then(this.attempts(key), (attempts) =>
      Math.max(0, maxAttempts - attempts),
    );
  }

  retriesLeft(key: string, maxAttempts: number): MaybePromise<number> {
    return this.remaining(key, maxAttempts);
  }

  /** Seconds until the window ends and another hit is allowed. */
  availableIn(key: string, _maxAttempts?: number): MaybePromise<number> {
    return then(this.#store.get(key + TIMER), (timer) =>
      timer === undefined ? 0 : Math.max(0, Math.ceil(timer - nowSeconds())),
    );
  }

  /** Unix timestamp (seconds) when the lockout ends. */
  availableAt(key: string, maxAttempts?: number): MaybePromise<number> {
    return then(
      this.availableIn(key, maxAttempts),
      (seconds) => Math.floor(Date.now() / 1000) + seconds,
    );
  }

  /**
   * Record a hit and say whether it is allowed. The hit is counted first and the count it gets decides,
   * so requests arriving together cannot all pass a check made before any of them was counted. A
   * blocked attempt is counted too, which does not extend the window.
   *
   * Callback form: `attempt(key, max, callback, decaySeconds?)` runs the callback only when the
   * attempt is allowed.
   */
  attempt(
    key: string,
    maxAttempts: number,
    decaySecondsOrCallback?: number | (() => unknown | Promise<unknown>),
    decaySeconds = 60,
  ): RateLimitResult | Promise<RateLimitResult | unknown> {
    if (typeof decaySecondsOrCallback === "function") {
      const callback = decaySecondsOrCallback;
      return (async () => {
        const hits = await this.hit(key, decaySeconds);
        if (hits > maxAttempts) return this.#blocked(key, maxAttempts);
        return callback();
      })();
    }
    const decay =
      typeof decaySecondsOrCallback === "number" ? decaySecondsOrCallback : 60;
    return then(this.hit(key, decay), (hits) =>
      then(this.availableIn(key), (wait) =>
        hits > maxAttempts
          ? {
              allowed: false,
              limit: maxAttempts,
              remaining: 0,
              retryAfter: Math.max(1, wait),
              resetAt: Date.now() + Math.max(1, wait) * 1000,
            }
          : {
              allowed: true,
              limit: maxAttempts,
              remaining: Math.max(0, maxAttempts - hits),
              retryAfter: 0,
              resetAt: Date.now() + wait * 1000,
            },
      ),
    ) as RateLimitResult | Promise<RateLimitResult>;
  }

  #blocked(key: string, maxAttempts: number): MaybePromise<RateLimitResult> {
    return then(this.availableIn(key), (wait) => ({
      allowed: false,
      limit: maxAttempts,
      remaining: 0,
      retryAfter: Math.max(1, wait),
      resetAt: Date.now() + Math.max(1, wait) * 1000,
    }));
  }

  /** Evaluate a named limiter against the request. */
  async attemptNamed(name: string, request: Request): Promise<RateLimitResult> {
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

  /** Reset attempts for a key (the window timer stays until it ends). */
  resetAttempts(key: string): MaybePromise<void> {
    return then(this.#store.forget(key), () => undefined);
  }

  /** Forget a key and its window. */
  clear(key: string): MaybePromise<void> {
    const store = this.#store;
    return then(this.resetAttempts(key), () =>
      then(store.forget(key + TIMER), () => undefined),
    );
  }

  /** Forget every counter held in this process. */
  flush(): void {
    this.#local.clear();
  }

  /** Normalize a limiter key. */
  cleanRateLimiterKey(key: string): string {
    return key.replace(/&/g, "").replace(/:/g, "").slice(0, 200);
  }

  /** No-op (cache serialization is the cache's concern). */
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
