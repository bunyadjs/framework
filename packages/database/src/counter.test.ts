import { afterAll, describe, expect, test } from "bun:test";
import { Counter, connectPostgres, connectSqlite, type Connection } from "./index.ts";

const connections: Array<[string, Connection]> = [["sqlite", connectSqlite()]];
const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
if (pg && /^(postgres|postgresql):\/\//i.test(pg)) {
  connections.push(["postgres", connectPostgres({ url: pg, max: 8 })]);
}

describe.each(connections)("Counter (%s)", (_name, c) => {
  // Every test counts in a scope of its own, so tests do not see each other's numbers.
  const fresh = () => crypto.randomUUID();
  const own = `own_counters_${Date.now()}`;
  afterAll(async () => {
    await c.exec("DROP TABLE IF EXISTS counters");
    await c.exec("DROP TABLE IF EXISTS invoice_counters");
    await c.exec(`DROP TABLE IF EXISTS ${own}`);
  });

  const next = (scope: string, name: string, options: Parameters<typeof Counter.next>[2] = {}) =>
    Counter.next(scope, name, { connection: c, ...options });

  test("the table is made when it is missing", async () => {
    const t1 = fresh();
    expect(await next(t1, "invoice", { table: own })).toBe(1);
    expect(await next(t1, "invoice", { table: own })).toBe(2);
  });

  test("counts up from 1", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "invoice")).toBe(1);
    expect(await next(t1, "invoice")).toBe(2);
    expect(await next(t1, "invoice")).toBe(3);
  });

  test("a scope and a name each have their own count", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "invoice")).toBe(1);
    expect(await next(t1, "invoice")).toBe(2);
    expect(await next(t2, "invoice")).toBe(1);
    expect(await next(t1, "receipt")).toBe(1);
    expect(await next(t1, "invoice")).toBe(3);
  });

  test("start sets the first number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "a", { start: 100 })).toBe(100);
    expect(await next(t1, "a", { start: 100 })).toBe(101);
  });

  test("seed gives the highest number already in use, and is asked for once", async () => {
    const t1 = fresh();
    const t2 = fresh();
    let asked = 0;
    const seed = () => {
      asked += 1;
      return 41;
    };
    expect(await next(t1, "invoice", { seed })).toBe(42);
    expect(await next(t1, "invoice", { seed })).toBe(43);
    expect(await next(t1, "invoice", { seed })).toBe(44);
    expect(asked).toBe(1);
  });

  test("a seed of nothing (0, null, nonsense) starts at the first number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "a", { seed: () => 0 })).toBe(1);
    expect(await next(t1, "b", { seed: () => Number.NaN })).toBe(1);
    expect(await next(t1, "c", { seed: async () => -5 })).toBe(1);
  });

  test("an async seed works", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "invoice", { seed: async () => 9 })).toBe(10);
  });

  test("many callers at once each get their own number, with no gap", async () => {
    const t1 = fresh();
    const t2 = fresh();
    const numbers = await Promise.all(Array.from({ length: 200 }, () => next(t1, "busy")));
    expect(new Set(numbers).size).toBe(200);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });

  test("many first callers at once, each working out the seed, still get their own number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => next(t1, "fresh", { seed: async () => 100 })),
    );
    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => 101 + i));
  });

  test("numbers past 32 bits are fine", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "big", { seed: () => 3_000_000_000 })).toBe(3_000_000_001);
    expect(await next(t1, "big")).toBe(3_000_000_002);
  });

  test("a rolled back transaction does not use up its number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await next(t1, "txn");
    await next(t1, "txn");
    await expect(
      c.transaction(async () => {
        // inside the transaction, the same connection takes part in it
        expect(await next(t1, "txn")).toBe(3);
        throw new Error("sale failed");
      }),
    ).rejects.toThrow("sale failed");
    expect(await Counter.peek(t1, "txn", { connection: c })).toBe(2);
    expect(await next(t1, "txn")).toBe(3);
  });

  test("a committed transaction keeps its number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await c.transaction(async () => {
      expect(await next(t1, "txn")).toBe(1);
      expect(await next(t1, "txn")).toBe(2);
    });
    expect(await Counter.peek(t1, "txn", { connection: c })).toBe(2);
  });

  test("peek reads without counting, and is null before the first number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await Counter.peek(t1, "x", { connection: c })).toBeNull();
    await next(t1, "x");
    expect(await Counter.peek(t1, "x", { connection: c })).toBe(1);
    expect(await Counter.peek(t1, "x", { connection: c })).toBe(1);
  });

  test("reset forgets a counter, and set puts it at a number", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await next(t1, "x");
    await next(t1, "x");
    await Counter.reset(t1, "x", { connection: c });
    expect(await next(t1, "x")).toBe(1);
    await Counter.set(t1, "x", 500, { connection: c });
    expect(await next(t1, "x")).toBe(501);
  });

  test("many first callers at once on a database with no counters table do not trip over making it", async () => {
    const table = `race_counters_${Date.now()}`;
    try {
      const t1 = fresh();
      const numbers = await Promise.all(Array.from({ length: 40 }, () => next(t1, "first", { table })));
      expect(new Set(numbers).size).toBe(40);
      expect(Math.max(...numbers)).toBe(40);
    } finally {
      await c.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  test("a table made inside a transaction that is rolled back is made again when it is needed", async () => {
    const table = `rolled_counters_${Date.now()}`;
    try {
      const t1 = fresh();
      await expect(
        c.transaction(async () => {
          expect(await next(t1, "x", { table })).toBe(1);
          throw new Error("rolled back");
        }),
      ).rejects.toThrow("rolled back");
      // the table went with the transaction; the next caller must not assume it is there
      expect(await next(t1, "x", { table })).toBe(1);
      expect(await next(t1, "x", { table })).toBe(2);
    } finally {
      await c.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  test("inside one transaction the table is checked for once, not for every number", async () => {
    const table = `checked_counters_${Date.now()}`;
    try {
      const t1 = fresh();
      const seen: string[] = [];
      const exec = c.exec.bind(c);
      const all = c.all.bind(c);
      c.exec = ((sql: string) => (seen.push(sql), exec(sql))) as typeof c.exec;
      c.all = ((sql: string, params?: unknown[]) => (seen.push(sql), all(sql, params))) as typeof c.all;
      try {
        await c.transaction(async () => {
          for (let i = 0; i < 25; i += 1) await next(t1, "x", { table });
        });
      } finally {
        c.exec = exec;
        c.all = all;
      }
      const checks = seen.filter((sql) => /CREATE TABLE|to_regclass/i.test(sql));
      expect(checks.length).toBeLessThanOrEqual(2); // looked for, then made (Postgres), or made (SQLite)
    } finally {
      await c.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  test("install: false never looks for or makes the table", async () => {
    const t1 = fresh();
    await Counter.install({ connection: c });
    const seen: string[] = [];
    const exec = c.exec.bind(c);
    const all = c.all.bind(c);
    c.exec = ((sql: string) => (seen.push(sql), exec(sql))) as typeof c.exec;
    c.all = ((sql: string, params?: unknown[]) => (seen.push(sql), all(sql, params))) as typeof c.all;
    try {
      await next(t1, "x", { install: false });
      await next(t1, "x", { install: false });
    } finally {
      c.exec = exec;
      c.all = all;
    }
    expect(seen.filter((sql) => /CREATE TABLE|to_regclass/i.test(sql))).toEqual([]);
  });

  test("a table of your own choosing can be used", async () => {
    const t1 = fresh();
    const t2 = fresh();
    expect(await next(t1, "a", { table: "invoice_counters" })).toBe(1);
    expect(await Counter.peek(t1, "a", { connection: c, table: "invoice_counters" })).toBe(1);
    expect(await Counter.peek(t1, "a", { connection: c })).toBeNull();
  });

  test("a table name that is not a plain name is refused", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await expect(next(t1, "a", { table: "counters; DROP TABLE users" })).rejects.toThrow("table name");
  });

  test("scope and name are bound, never written into the statement", async () => {
    const hostile = "x'); DROP TABLE counters; --";
    expect(await next(hostile, hostile)).toBe(1);
    expect(await next(hostile, hostile)).toBe(2);
    expect(await Counter.peek(hostile, hostile, { connection: c })).toBe(2);
  });

  test("install can be called again and again", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await Counter.install({ connection: c });
    await Counter.install({ connection: c });
    expect(await next(t1, "a")).toBe(1);
  });

  test("it stays fast however many numbers have been handed out", async () => {
    const t1 = fresh();
    const t2 = fresh();
    await Counter.set(t1, "big", 5_000_000, { connection: c });
    for (let i = 0; i < 200; i += 1) await next(t1, "big");
    const started = performance.now();
    for (let i = 0; i < 2_000; i += 1) await next(t1, "big");
    expect((performance.now() - started) / 2_000).toBeLessThan(5); // milliseconds, with room to spare
  });
});

describe("drivers it does not support", () => {
  test("say so instead of guessing", async () => {
    const fake = { driver: "mysql", all: async () => [], run: async () => 0, exec: async () => undefined };
    await expect(Counter.next("t", "n", { connection: fake as never })).rejects.toThrow("sqlite and postgres");
  });
});
