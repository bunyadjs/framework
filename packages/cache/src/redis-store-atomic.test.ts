/**
 * Counters and "set if absent" on Redis must be single commands, so servers sharing one Redis never
 * lose an increment and a key is never left without its expiry. Needs a Redis: set
 * BUNYAD_TEST_REDIS_URL (the tests are skipped without it).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { RedisCacheStore } from "./redis-store.ts";

const url = Bun.env.BUNYAD_TEST_REDIS_URL;
const run = url ? describe : describe.skip;

run("RedisCacheStore on a real Redis", () => {
  const clients: RedisClient[] = [];
  /** A store with its own connection, as another server would have. */
  const server = (prefix = "atomic:") => {
    const client = new RedisClient(url!);
    clients.push(client);
    return new RedisCacheStore({ client, prefix });
  };
  const raw = new RedisClient(url ?? "redis://127.0.0.1:6379");

  afterAll(async () => {
    await raw.send("FLUSHDB", []);
    raw.close();
    for (const client of clients) client.close();
  });

  test("increments from several servers at once are all counted", async () => {
    const servers = [server(), server(), server()];
    await servers[0]!.put("hits", 0, 60);
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => servers[i % 3]!.increment("hits")),
    );
    expect(await servers[1]!.get<unknown>("hits")).toBe(300);
  });

  test("an increment keeps the key's expiry", async () => {
    const store = server();
    await store.put("timed", 5, 100);
    await store.increment("timed", 2);
    const ttl = Number(await raw.send("TTL", ["atomic:timed"]));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(100);
    expect(await store.get<unknown>("timed")).toBe(7);
  });

  test("decrement lowers the count", async () => {
    const store = server();
    await store.put("down", 10, 60);
    expect(await store.decrement("down", 3)).toBe(7);
  });

  test("add: of many servers adding one key together, exactly one wins", async () => {
    const servers = [server(), server(), server(), server()];
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => servers[i % 4]!.add("once", i, 60)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("add sets the expiry in the same step: a new key always has one", async () => {
    const store = server();
    expect(await store.add("fresh", 1, 30)).toBe(true);
    const ttl = Number(await raw.send("TTL", ["atomic:fresh"]));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    expect(await store.add("fresh", 2, 30)).toBe(false);
    expect(await store.get<unknown>("fresh")).toBe(1);
  });

  test("add without a time to live makes a key that does not expire", async () => {
    const store = server();
    expect(await store.add("forever", "x")).toBe(true);
    expect(Number(await raw.send("TTL", ["atomic:forever"]))).toBe(-1);
  });

  test("incrementing a value that is not a whole number still works", async () => {
    const store = server();
    await store.put("float", 1.5, 60);
    expect(await store.increment("float", 1)).toBe(2.5);
    await store.put("object", { a: 1 }, 60);
    expect(await store.increment("object", 1)).toBe(1);
  });

  test("incrementing a missing key creates it", async () => {
    const store = server();
    expect(await store.increment("new", 4)).toBe(4);
    expect(await store.get<unknown>("new")).toBe(4);
  });
});
