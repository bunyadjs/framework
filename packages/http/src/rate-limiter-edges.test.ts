import { describe, expect, test } from "bun:test";
import { RateLimiter, type RateLimiterCache } from "./rate-limiter.ts";

/** A cache whose `increment` can be told to act as if the key had just expired. */
function fakeCache(options: { expireBeforeIncrement?: boolean } = {}) {
  const data = new Map<string, { value: number; ttl?: number }>();
  const puts: Array<{ key: string; value: unknown; seconds?: number }> = [];
  const cache: RateLimiterCache = {
    async get<T>(key: string) {
      return data.get(key)?.value as T | undefined;
    },
    async put(key, value, seconds) {
      puts.push({ key, value, seconds });
      data.set(key, { value: Number(value), ttl: seconds });
    },
    async add(key, value, seconds) {
      if (data.has(key)) return false;
      data.set(key, { value: Number(value), ttl: seconds });
      return true;
    },
    async increment(key, amount = 1) {
      if (options.expireBeforeIncrement) data.delete(key);
      const row = data.get(key);
      const next = (row?.value ?? 0) + amount;
      data.set(key, { value: next, ttl: row?.ttl }); // like Redis: a new key has no expiry
      return next;
    },
    async forget(key) {
      return data.delete(key);
    },
  };
  return { cache, data, puts };
}

describe("decrement", () => {
  test("never creates a key that is not there (no counter without an expiry)", async () => {
    const { cache, data } = fakeCache();
    const limiter = new RateLimiter().use(cache);
    expect(await limiter.decrement("ghost")).toBe(0);
    expect(data.has("bunyad:rate:ghost")).toBe(false);
  });

  test("takes attempts off a key that exists", async () => {
    const { cache } = fakeCache();
    const limiter = new RateLimiter().use(cache);
    await limiter.hit("k", 60);
    await limiter.hit("k", 60);
    expect(await limiter.decrement("k")).toBe(1);
  });

  test("works without a cache too", () => {
    const limiter = new RateLimiter();
    expect(limiter.decrement("ghost")).toBe(0);
    limiter.hit("k", 60);
    limiter.hit("k", 60);
    expect(limiter.decrement("k")).toBe(1);
  });
});

describe("a window that ends between two steps of a hit", () => {
  test("the counter the cache made gets the window as its expiry, and keeps its count", async () => {
    const { cache, puts } = fakeCache({ expireBeforeIncrement: true });
    const limiter = new RateLimiter().use(cache);
    // the key exists when add runs; it has expired by the time increment runs
    await cache.add("bunyad:rate:k", 5, 60);
    const hits = await limiter.hit("k", 60);
    expect(hits).toBe(1);
    const repair = puts.find((p) => p.key === "bunyad:rate:k");
    expect(repair).toBeDefined();
    expect(repair!.seconds).toBe(60);
    expect(repair!.value).toBe(1);
  });
});

describe("attempt with a callback", () => {
  test("checks, then counts, then runs the callback; a spent key skips both", async () => {
    const limiter = new RateLimiter();
    let ran = 0;
    for (let i = 0; i < 3; i += 1) {
      await limiter.attempt("send", 2, async () => {
        ran += 1;
        return true;
      }, 60);
    }
    expect(ran).toBe(2);
    expect(limiter.attempts("send")).toBe(2); // the blocked call did not count
  });
});
