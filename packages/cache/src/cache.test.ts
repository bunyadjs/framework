import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  MemoryCacheStore,
  FileCacheStore,
  CacheRepository,
  setCache,
  cache,
  Cache,
} from "../src/index.ts";

test("Cache.get callback default runs only on miss and does not store", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  let calls = 0;

  expect(
    await Cache.get("missing", () => {
      calls += 1;
      return "fallback";
    }),
  ).toBe("fallback");
  expect(calls).toBe(1);
  expect(await Cache.get("missing")).toBeUndefined();

  await Cache.put("present", "cached", 60);
  expect(
    await Cache.get("present", () => {
      calls += 1;
      return "nope";
    }),
  ).toBe("cached");
  expect(calls).toBe(1);

  expect(await Cache.get("plain", "static-default")).toBe("static-default");

  expect(
    await Cache.pull("gone", async () => {
      calls += 1;
      return "pulled-default";
    }),
  ).toBe("pulled-default");
  expect(calls).toBe(2);
});

test("Cache.store resolves named stores registered via setCacheStore", async () => {
  const fileLike = new CacheRepository(new MemoryCacheStore(), { store: "file" });
  setCache(new CacheRepository(new MemoryCacheStore(), { store: "memory" }));
  const { setCacheStore } = await import("../src/repository.ts");
  setCacheStore("file", fileLike);

  await fileLike.put("k", "from-file", 60);
  await Cache.put("k", "from-memory", 60);

  expect(await Cache.store("file").get("k")).toBe("from-file");
  expect(await Cache.store("memory").get("k")).toBe("from-memory");
  expect(await Cache.store().get("k")).toBe("from-memory");
});

test("memory store put get expire forget", async () => {
  const store = new MemoryCacheStore();
  await store.put("a", 1, 60);
  expect(await store.get("a")).toBe(1);
  expect(await store.has("a")).toBe(true);
  await store.forget("a");
  expect(await store.get("a")).toBeUndefined();

  await store.put("b", "x", 0);
  expect(await store.get("b")).toBeUndefined();
});

test("repository remember", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  setCache(repo);

  let calls = 0;
  const value = await cache().remember("users", 60, () => {
    calls += 1;
    return ["Ada"];
  });
  expect(value).toEqual(["Ada"]);
  expect(await cache().remember("users", 60, () => {
    calls += 1;
    return ["Bob"];
  })).toEqual(["Ada"]);
  expect(calls).toBe(1);
});

test("Cache facade mirrors repository", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  await Cache.put("name", "Ada", 60);
  expect(await Cache.get("name")).toBe("Ada");
  expect(await Cache.has("name")).toBe(true);
  expect(await Cache.forget("name")).toBe(true);
  expect(await Cache.get("name")).toBeUndefined();
});

test("Cache.fake records keys in memory", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  Cache.fake();

  await Cache.put("user:1", { name: "Ada" }, 60);
  await Cache.assertHas("user:1");
  await Cache.assertHasValue("user:1", { name: "Ada" });
  await Cache.forget("user:1");
  await Cache.assertMissing("user:1");

  Cache.restore();
});

test("repository add is set-if-absent", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  expect(await repo.add("lock", 1, 60)).toBe(true);
  expect(await repo.add("lock", 2, 60)).toBe(false);
  expect(await repo.get("lock")).toBe(1);
});

test("file store put get forget flush", async () => {
  const dir = resolve(import.meta.dir, "../.tmp-cache-test");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const store = new FileCacheStore({ path: dir });
  await store.put("greeting", { hello: "world" }, 60);
  expect(await store.get("greeting")).toEqual({ hello: "world" });
  expect(await store.has("greeting")).toBe(true);
  await store.forget("greeting");
  expect(await store.get("greeting")).toBeUndefined();

  await store.put("a", 1);
  await store.put("b", 2);
  await store.flush();
  expect(await store.get("a")).toBeUndefined();
  expect(await store.get("b")).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("redis store with mock client", async () => {
  const map = new Map<string, string>();
  const client = {
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async set(key: string, value: string) {
      map.set(key, value);
      return "OK";
    },
    async expire(_key: string, _seconds: number) {
      return 1;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (map.delete(k)) n += 1;
      return n;
    },
    async exists(...keys: string[]) {
      return keys.filter((k) => map.has(k)).length;
    },
    async keys(pattern: string) {
      const prefix = pattern.replace(/\*$/, "");
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
    close() {},
  };

  const { RedisCacheStore } = await import("../src/redis-store.ts");
  const store = new RedisCacheStore({
    client: client as never,
    prefix: "t:",
  });
  await store.put("x", { n: 1 }, 60);
  expect(await store.get("x")).toEqual({ n: 1 });
  expect(await store.has("x")).toBe(true);
  await store.forget("x");
  expect(await store.get("x")).toBeUndefined();
});

test("database store put get expire forget flush", async () => {
  const rows = new Map<string, { key: string; value: string; expiration: number }>();
  const connection = {
    async run(sql: string, params: unknown[] = []) {
      if (sql.startsWith("INSERT")) {
        const [key, value, expiration] = params as [string, string, number];
        rows.set(key, { key, value, expiration });
        return;
      }
      if (sql.startsWith("UPDATE")) {
        const [value, expiration, key] = params as [string, number, string];
        const row = rows.get(key);
        if (row) {
          row.value = value;
          row.expiration = expiration;
        }
        return;
      }
      if (sql.startsWith("DELETE FROM") && sql.includes("LIKE")) {
        const prefix = String(params[0]).replace(/%$/, "");
        for (const k of [...rows.keys()]) {
          if (k.startsWith(prefix)) rows.delete(k);
        }
        return;
      }
      if (sql.startsWith("DELETE")) {
        if (params[0] !== undefined) rows.delete(String(params[0]));
        else rows.clear();
      }
    },
    async get<T>(sql: string, params: unknown[] = []) {
      if (sql.includes("WHERE key = ?")) {
        return (rows.get(String(params[0])) as T) ?? null;
      }
      return null;
    },
    async all() {
      return [...rows.values()];
    },
  };

  const { DatabaseCacheStore } = await import("../src/database-store.ts");
  const store = new DatabaseCacheStore({ connection, prefix: "c:" });

  await store.put("greeting", { hello: "world" }, 60);
  expect(await store.get("greeting")).toEqual({ hello: "world" });
  expect(await store.has("greeting")).toBe(true);

  await store.put("greeting", { hello: "again" }, 60);
  expect(await store.get("greeting")).toEqual({ hello: "again" });

  await store.forget("greeting");
  expect(await store.get("greeting")).toBeUndefined();

  await store.put("a", 1, 60);
  await store.put("b", 2, 60);
  await store.flush();
  expect(await store.get("a")).toBeUndefined();
  expect(await store.get("b")).toBeUndefined();
});

test("Cache.tags put get flush", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));

  await Cache.tags(["people", "authors"]).put("ada", { name: "Ada" }, 60);
  expect(await Cache.tags(["people", "authors"]).get("ada")).toEqual({
    name: "Ada",
  });
  expect(await Cache.get("ada")).toBeUndefined();

  await Cache.tags(["people"]).put("alan", { name: "Alan" }, 60);
  await Cache.tags(["people"]).flush();

  expect(await Cache.tags(["people", "authors"]).get("ada")).toBeUndefined();
  expect(await Cache.tags(["people"]).get("alan")).toBeUndefined();
});

test("tagged remember and add", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  const tagged = repo.tags("reports");

  let calls = 0;
  expect(
    await tagged.remember("daily", 60, () => {
      calls += 1;
      return 42;
    }),
  ).toBe(42);
  expect(
    await tagged.remember("daily", 60, () => {
      calls += 1;
      return 99;
    }),
  ).toBe(42);
  expect(calls).toBe(1);

  expect(await tagged.add("lock", 1, 60)).toBe(true);
  expect(await tagged.add("lock", 2, 60)).toBe(false);
});

test("pull increment decrement many putMany missing", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));

  await Cache.put("token", "abc", 60);
  expect(await Cache.pull("token")).toBe("abc");
  expect(await Cache.get("token")).toBeUndefined();
  expect(await Cache.pull("missing", "fallback")).toBe("fallback");

  expect(await Cache.missing("visits")).toBe(true);
  expect(await Cache.increment("visits")).toBe(1);
  expect(await Cache.increment("visits", 2)).toBe(3);
  expect(await Cache.decrement("visits")).toBe(2);
  expect(await Cache.missing("visits")).toBe(false);

  await Cache.putMany({ a: 1, b: 2 }, 60);
  expect(await Cache.many(["a", "b", "c"])).toEqual({
    a: 1,
    b: 2,
    c: undefined,
  });

  const tagged = Cache.tags("stats");
  expect(await tagged.increment("hits", 5)).toBe(5);
  expect(await tagged.pull("hits")).toBe(5);
  expect(await tagged.missing("hits")).toBe(true);
});

test("increment preserves memory TTL", async () => {
  const store = new MemoryCacheStore();
  await store.put("n", 10, 60);
  expect(await store.increment("n", 1)).toBe(11);
  expect(await store.get("n")).toBe(11);
  expect(await store.has("n")).toBe(true);
});

test("typed getters string integer float boolean array", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  await repo.put("s", "hi", 60);
  await repo.put("i", 7, 60);
  await repo.put("f", 1.5, 60);
  await repo.put("b", true, 60);
  await repo.put("a", [1, 2], 60);

  expect(await repo.string("s")).toBe("hi");
  expect(await repo.integer("i")).toBe(7);
  expect(await repo.float("f")).toBe(1.5);
  expect(await repo.boolean("b")).toBe(true);
  expect(await repo.array("a")).toEqual([1, 2]);

  await repo.put("bad", 1, 60);
  expect(repo.string("bad")).rejects.toThrow(/must be a string/);
});

test("PSR-16 aliases and putManyForever", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));

  expect(await Cache.set("x", 1, 60)).toBe(true);
  expect(await Cache.get("x")).toBe(1);
  expect(await Cache.delete("x")).toBe(true);
  expect(await Cache.get("x")).toBeUndefined();

  await Cache.setMultiple({ a: 1, b: 2 }, 60);
  expect(await Cache.getMultiple(["a", "b", "c"], 0)).toEqual({
    a: 1,
    b: 2,
    c: 0,
  });
  expect(await Cache.deleteMultiple(["a", "b"])).toBe(true);

  expect(await Cache.putManyForever({ forever: true })).toBe(true);
  expect(await Cache.get("forever")).toBe(true);
  expect(await Cache.clear()).toBe(true);
  expect(await Cache.get("forever")).toBeUndefined();
});

test("sear rememberWithWarmth touch getSeconds meta", async () => {
  const repo = new CacheRepository(new MemoryCacheStore(), { store: "memory" });
  expect(repo.getName()).toBe("memory");
  expect(repo.supportsTags()).toBe(true);
  expect(repo.getSeconds(90)).toBe(90);
  expect(repo.getSeconds(new Date(Date.now() - 1000))).toBe(0);

  repo.setDefaultCacheTime(30);
  expect(repo.getDefaultCacheTime()).toBe(30);

  let calls = 0;
  expect(
    await repo.sear("logo", () => {
      calls += 1;
      return "bunyad";
    }),
  ).toBe("bunyad");
  expect(
    await repo.sear("logo", () => {
      calls += 1;
      return "other";
    }),
  ).toBe("bunyad");
  expect(calls).toBe(1);

  const [warmValue, wasWarm] = await repo.rememberWithWarmth("w", 60, () => "ok");
  expect(warmValue).toBe("ok");
  expect(wasWarm).toBe(false);
  const [, warmAgain] = await repo.rememberWithWarmth("w", 60, () => "nope");
  expect(warmAgain).toBe(true);

  await repo.put("ttl", "v", 60);
  expect(await repo.touch("ttl", 120)).toBe(true);
  expect(await repo.get("ttl")).toBe("v");
  expect(await repo.touch("missing", 60)).toBe(false);
});

test("flexible serves stale while refreshing", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  let calls = 0;
  const value = await repo.flexible("swr", [1, 5], () => {
    calls += 1;
    return `v${calls}`;
  });
  expect(value).toBe("v1");
  expect(calls).toBe(1);

  expect(await repo.flexible("swr", [1, 5], () => {
    calls += 1;
    return `v${calls}`;
  })).toBe("v1");
  expect(calls).toBe(1);

  await Bun.sleep(1100);
  const stale = await repo.flexible("swr", [1, 5], async () => {
    calls += 1;
    await Bun.sleep(20);
    return `v${calls}`;
  });
  expect(stale).toBe("v1");
  await Bun.sleep(50);
  expect(calls).toBe(2);
  expect(await repo.get("swr")).toBe("v2");
});

test("tagged cache inherits typed getters and getTags", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  const tagged = repo.tags(["alpha", "beta"]);
  expect(tagged.getTags()).toEqual(["alpha", "beta"]);

  await tagged.put("n", 3, 60);
  expect(await tagged.integer("n")).toBe(3);
  expect(await tagged.delete("n")).toBe(true);
  expect(await tagged.clear()).toBe(true);
});

test("Cache.memo remembers get within execution and invalidates on put", async () => {
  let hits = 0;
  const underlying = new MemoryCacheStore();
  const counting = {
    get: async <T = unknown>(key: string) => {
      hits += 1;
      return underlying.get<T>(key);
    },
    put: (key: string, value: unknown, seconds?: number) =>
      underlying.put(key, value, seconds),
    forever: (key: string, value: unknown) => underlying.forever(key, value),
    forget: (key: string) => underlying.forget(key),
    flush: () => underlying.flush(),
    has: (key: string) => underlying.has(key),
    increment: (key: string, value?: number) => underlying.increment(key, value),
    decrement: (key: string, value?: number) => underlying.decrement(key, value),
  };
  setCache(new CacheRepository(counting));
  Cache.flushMemo();

  await Cache.put("name", "Taylor", 60);
  hits = 0;

  expect(await Cache.memo().get("name")).toBe("Taylor");
  expect(await Cache.memo().get("name")).toBe("Taylor");
  expect(hits).toBe(1);

  await Cache.memo().put("name", "Tim", 60);
  hits = 0;
  expect(await Cache.memo().get("name")).toBe("Tim");
  expect(hits).toBe(1);
  expect(await Cache.memo().get("name")).toBe("Tim");
  expect(hits).toBe(1);

  Cache.flushMemo();
});

test("Cache.memo(store) uses named store", async () => {
  const redisLike = new CacheRepository(new MemoryCacheStore(), { store: "redis" });
  setCache(new CacheRepository(new MemoryCacheStore(), { store: "default" }));
  const { setCacheStore } = await import("../src/repository.ts");
  setCacheStore("redis", redisLike);

  await redisLike.put("k", "from-redis", 60);
  await Cache.put("k", "from-default", 60);

  expect(await Cache.memo("redis").get("k")).toBe("from-redis");
  expect(await Cache.memo().get("k")).toBe("from-default");
  Cache.flushMemo();
});

test("Cache.memo forget and increment drop memoized value", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  Cache.flushMemo();
  const memo = Cache.memo();
  await memo.put("n", 1, 60);
  expect(await memo.get("n")).toBe(1);
  expect(await memo.increment("n")).toBe(2);
  expect(await memo.get("n")).toBe(2);
  await memo.forget("n");
  expect(await memo.get("n")).toBeUndefined();
  Cache.flushMemo();
});

test("forever rememberForever flush on Cache facade", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));

  await Cache.forever("config", { theme: "dark" });
  expect(await Cache.get("config")).toEqual({ theme: "dark" });
  expect(await Cache.has("config")).toBe(true);

  let calls = 0;
  expect(
    await Cache.rememberForever("settings", () => {
      calls += 1;
      return { locale: "en" };
    }),
  ).toEqual({ locale: "en" });
  expect(
    await Cache.rememberForever("settings", () => {
      calls += 1;
      return { locale: "ur" };
    }),
  ).toEqual({ locale: "en" });
  expect(calls).toBe(1);

  await Cache.flush();
  expect(await Cache.get("config")).toBeUndefined();
  expect(await Cache.get("settings")).toBeUndefined();
  expect(await Cache.has("config")).toBe(false);
});

test("memory store add is single-turn SET-if-absent under concurrency", async () => {
  const store = new MemoryCacheStore();
  const results = await Promise.all(
    Array.from({ length: 40 }, (_, i) => store.add("lock", i, 60)),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await store.get("lock")).toBe(results.findIndex(Boolean));
});

test("redis store add uses setnx when available", async () => {
  const map = new Map<string, string>();
  const client = {
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async set(key: string, value: string) {
      map.set(key, value);
      return "OK";
    },
    async setnx(key: string, value: string) {
      if (map.has(key)) return 0;
      map.set(key, value);
      return 1;
    },
    async expire(_key: string, _seconds: number) {
      return 1;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (map.delete(k)) n += 1;
      return n;
    },
    async exists(...keys: string[]) {
      return keys.filter((k) => map.has(k)).length;
    },
    async keys(pattern: string) {
      const prefix = pattern.replace(/\*$/, "");
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
    close() {},
  };

  const { RedisCacheStore } = await import("../src/redis-store.ts");
  const store = new RedisCacheStore({
    client: client as never,
    prefix: "t:",
  });
  expect(await store.add("lock", "a", 60)).toBe(true);
  expect(await store.add("lock", "b", 60)).toBe(false);
  expect(await store.get("lock")).toBe("a");
});

test("Cache.lock get block release", async () => {
  const repo = new CacheRepository(new MemoryCacheStore());
  setCache(repo);

  const lock = Cache.lock("orders", 10);
  expect(await lock.get()).toBe(true);
  expect(await Cache.lock("orders", 10).get()).toBe(false);
  expect(await lock.release()).toBe(true);
  expect(await Cache.lock("orders", 10).get()).toBe(true);

  const result = await Cache.lock("job", 5).get(async () => "done");
  expect(result).toBe("done");
  expect(await Cache.lock("job", 5).get()).toBe(true);

  await Cache.flushLocks();
});

test("Cache.put accepts Date TTL", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  const until = new Date(Date.now() + 60_000);
  await Cache.put("dated", "v", until);
  expect(await Cache.get("dated")).toBe("v");
});

test("FailoverCacheStore tries next store on failure", async () => {
  const { FailoverCacheStore } = await import("../src/failover-store.ts");
  const primary: import("@bunyad/contracts").CacheStore = {
    async get() {
      throw new Error("down");
    },
    async put() {
      throw new Error("down");
    },
    async forever() {
      throw new Error("down");
    },
    async forget() {
      throw new Error("down");
    },
    async flush() {
      throw new Error("down");
    },
    async has() {
      throw new Error("down");
    },
    async increment() {
      throw new Error("down");
    },
    async decrement() {
      throw new Error("down");
    },
    async add() {
      throw new Error("down");
    },
  };
  const secondary = new MemoryCacheStore();
  const store = new FailoverCacheStore([primary, secondary]);
  await store.put("k", "ok", 60);
  expect(await store.get("k")).toBe("ok");
});

test("Cache.funnel limits concurrent work", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  let running = 0;
  let max = 0;
  const jobs = Array.from({ length: 4 }, () =>
    Cache.funnel("jobs")
      .limit(2)
      .block(5)
      .then(async () => {
        running += 1;
        max = Math.max(max, running);
        await Bun.sleep(20);
        running -= 1;
      }),
  );
  await Promise.all(jobs);
  expect(max).toBeLessThanOrEqual(2);
});

test("optional cache events fire when enabled", async () => {
  const {
    setCacheEventsEnabled,
    setCacheEventDispatcher,
    CacheHit,
    CacheMissed,
    KeyWritten,
  } = await import("../src/events.ts");
  const seen: string[] = [];
  setCacheEventsEnabled(true);
  setCacheEventDispatcher({
    dispatch(event) {
      seen.push(event.constructor.name);
    },
  });
  setCache(new CacheRepository(new MemoryCacheStore(), { store: "memory" }));
  await Cache.get("missing");
  await Cache.put("k", 1, 10);
  await Cache.get("k");
  expect(seen).toContain(CacheMissed.name);
  expect(seen).toContain(KeyWritten.name);
  expect(seen).toContain(CacheHit.name);
  setCacheEventsEnabled(false);
  setCacheEventDispatcher(undefined);
});
