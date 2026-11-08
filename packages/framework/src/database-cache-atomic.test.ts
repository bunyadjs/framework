/**
 * The database cache store backs counters shared by several workers (rate limits), so `add` and
 * `increment` must each be one atomic step. Run against real databases.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { DatabaseCacheStore } from "@bunyad/cache";
import { connectPostgres, connectSqlite, type Connection } from "@bunyad/database";
import { RateLimiter } from "@bunyad/http";

async function testDrivers(): Promise<Array<{ name: string; connection: Connection }>> {
  const drivers = [{ name: "sqlite", connection: connectSqlite() as Connection }];
  const url = Bun.env.BUNYAD_TEST_POSTGRES_URL;
  if (url && /^(postgres|postgresql):\/\//i.test(url)) {
    const connection = connectPostgres({ url, max: 6 });
    try {
      await connection.exec("SELECT 1");
      drivers.push({ name: "postgres", connection });
    } catch (error) {
      console.warn(`[database-cache-atomic] postgres unavailable: ${(error as Error).message}`);
    }
  }
  return drivers;
}

const drivers = await testDrivers();

afterAll(async () => {
  for (const { name, connection } of drivers) {
    if (name === "postgres") {
      await connection.exec("DROP TABLE IF EXISTS atomic_cache");
      await connection.close();
    }
  }
});

for (const { name, connection } of drivers) {
  describe(`database cache store counts atomically (${name})`, () => {
    const prefix = `t${Date.now()}:`;
    let n = 0;
    const fresh = async () => {
      if (n === 0) {
        await connection.exec("DROP TABLE IF EXISTS atomic_cache");
        await connection.exec(
          "CREATE TABLE atomic_cache (key VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL, expiration BIGINT NOT NULL)",
        );
      }
      n += 1;
      return new DatabaseCacheStore({ connection: connection as never, table: "atomic_cache", prefix: `${prefix}${n}:` });
    };

    test("of many simultaneous adds exactly one wins and none throws", async () => {
      const store = await fresh();
      const results = await Promise.all(Array.from({ length: 100 }, () => store.add("k", 1, 60)));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    test("an add over an expired row succeeds once", async () => {
      const store = await fresh();
      await store.put("k", 5, 1);
      await connection.run("UPDATE atomic_cache SET expiration = 1 WHERE key LIKE ?", [`%${"k"}`]);
      const results = await Promise.all(Array.from({ length: 20 }, () => store.add("k", 7, 60)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.get<number>("k")).toBe(7);
    });

    test("simultaneous increments of a new key all count", async () => {
      const store = await fresh();
      await Promise.all(Array.from({ length: 100 }, () => store.increment("c")));
      expect(await store.get<number>("c")).toBe(100);
    });

    test("simultaneous increments of an existing key all count and keep its expiry", async () => {
      const store = await fresh();
      await store.add("c", 0, 60);
      const before = await connection.get<{ expiration: number }>(
        "SELECT expiration FROM atomic_cache WHERE key LIKE ?",
        [`%c`],
      );
      await Promise.all(Array.from({ length: 100 }, () => store.increment("c", 2)));
      expect(await store.get<number>("c")).toBe(200);
      const after = await connection.get<{ expiration: number }>(
        "SELECT expiration FROM atomic_cache WHERE key LIKE ?",
        [`%c`],
      );
      expect(Number(after!.expiration)).toBe(Number(before!.expiration));
    });

    test("a decimal counter still adds", async () => {
      const store = await fresh();
      await store.put("d", 1.5, 60);
      expect(await store.increment("d", 1)).toBe(2.5);
    });

    test("two limiters over one database cache allow exactly the limit", async () => {
      const store = await fresh();
      const a = new RateLimiter().use(store as never);
      const b = new RateLimiter().use(store as never);
      const results = await Promise.all(
        Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).attempt("login", 5, 60) as Promise<{ allowed: boolean }>),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
    });
  });
}
