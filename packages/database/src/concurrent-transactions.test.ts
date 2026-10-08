import { expect, test } from "bun:test";
import { connectSqlite } from "./index.ts";

test("concurrent top-level transactions on one SQLite handle queue instead of colliding", async () => {
  const c = connectSqlite();
  await c.run("CREATE TABLE ct (id INTEGER PRIMARY KEY, n INTEGER)");
  await c.run("INSERT INTO ct (id, n) VALUES (1, 0)");
  const order: string[] = [];
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      c.transaction(async () => {
        order.push(`start${i}`);
        const row = await c.get<{ n: number }>("SELECT n FROM ct WHERE id = 1");
        await new Promise((r) => setTimeout(r, 1)); // yield so other transactions would interleave
        await c.run("UPDATE ct SET n = ? WHERE id = 1", [row!.n + 1]);
        order.push(`end${i}`);
      }),
    ),
  );
  expect((await c.get<{ n: number }>("SELECT n FROM ct WHERE id = 1"))!.n).toBe(10);
  // never two transactions in flight at once
  for (let i = 0; i < order.length; i += 2) {
    expect(order[i]!.startsWith("start")).toBe(true);
    expect(order[i + 1]).toBe(order[i]!.replace("start", "end"));
  }
});

test("a nested transaction inside a serialized one does not wait for itself", async () => {
  const c = connectSqlite();
  await c.run("CREATE TABLE ct2 (id INTEGER PRIMARY KEY)");
  await c.transaction(async () => {
    await c.transaction(async () => {
      await c.run("INSERT INTO ct2 (id) VALUES (1)");
    });
  });
  expect((await c.get<{ n: number }>("SELECT COUNT(*) AS n FROM ct2"))!.n).toBe(1);
});

test("a failing transaction releases the queue", async () => {
  const c = connectSqlite();
  await c.run("CREATE TABLE ct3 (id INTEGER PRIMARY KEY)");
  const results = await Promise.allSettled([
    c.transaction(async () => { throw new Error("nope"); }),
    c.transaction(async () => { await c.run("INSERT INTO ct3 (id) VALUES (1)"); }),
  ]);
  expect(results[0]!.status).toBe("rejected");
  expect(results[1]!.status).toBe("fulfilled");
  expect((await c.get<{ n: number }>("SELECT COUNT(*) AS n FROM ct3"))!.n).toBe(1);
});
