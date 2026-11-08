/**
 * The rate limiter counting on a real Redis through the cache repository, from several separate
 * connections acting as separate servers. Needs a Redis: set BUNYAD_TEST_REDIS_URL (skipped without it).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { CacheRepository, RedisCacheStore } from "@bunyad/cache";
import { RateLimiter, type RateLimitResult } from "@bunyad/http";

const url = Bun.env.BUNYAD_TEST_REDIS_URL;
const run = url ? describe : describe.skip;

run("RateLimiter on Redis", () => {
  const clients: RedisClient[] = [];
  /** A limiter with its own Redis connection and cache repository, like one server. */
  const server = () => {
    const client = new RedisClient(url!);
    clients.push(client);
    const store = new RedisCacheStore({ client, prefix: "rl-test:" });
    return new RateLimiter().use(new CacheRepository(store) as never);
  };
  const raw = new RedisClient(url ?? "redis://127.0.0.1:6379");

  afterAll(async () => {
    await raw.send("FLUSHDB", []);
    raw.close();
    for (const client of clients) client.close();
  });

  test("several servers share one count, and every hit is counted", async () => {
    const servers = [server(), server(), server()];
    await Promise.all(
      Array.from({ length: 150 }, (_, i) => servers[i % 3]!.hit("shared", 60)),
    );
    expect(await servers[2]!.attempts("shared")).toBe(150);
  });

  test("a limit of 5 allows exactly 5 of 200 simultaneous attempts from three servers", async () => {
    const servers = [server(), server(), server()];
    const results = (await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        servers[i % 3]!.attempt("login", 5, 60),
      ),
    )) as RateLimitResult[];
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => !r.allowed)).toHaveLength(195);
    expect(await servers[0]!.tooManyAttempts("login", 5)).toBe(true);
  });

  test("a window always has an expiry in Redis, so a client is never locked out for good", async () => {
    const limiter = server();
    await limiter.hit("expiring", 30);
    const counterTtl = Number(
      await raw.send("TTL", ["rl-test:bunyad:rate:expiring"]),
    );
    const timerTtl = Number(
      await raw.send("TTL", ["rl-test:bunyad:rate:expiring:timer"]),
    );
    expect(counterTtl).toBeGreaterThan(0);
    expect(counterTtl).toBeLessThanOrEqual(30);
    expect(timerTtl).toBeGreaterThan(0);
  });

  test("the window ends and the count starts again", async () => {
    const limiter = server();
    for (let i = 0; i < 3; i += 1) await limiter.attempt("short", 3, 1);
    expect(
      ((await limiter.attempt("short", 3, 1)) as RateLimitResult).allowed,
    ).toBe(false);
    await Bun.sleep(1200);
    expect(
      ((await limiter.attempt("short", 3, 1)) as RateLimitResult).allowed,
    ).toBe(true);
  });
});
