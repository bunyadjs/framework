import { afterEach, expect, test } from "bun:test";
import {
  clearQueryListeners,
  connectPostgres,
  connectSqlite,
  DatabaseManager,
  listen,
  schemaFor,
  type Connection,
} from "./index.bun.ts";

afterEach(() => clearQueryListeners());

const ROWS = 25;

async function seeded(connection: Connection, table = "cursor_items") {
  const schema = schemaFor(connection);
  await schema.create(table, (t) => {
    t.id();
    t.string("name");
    t.integer("qty");
  });
  const db = new DatabaseManager(connection);
  for (let i = 1; i <= ROWS; i++) {
    await db.table(table).insert({ name: `item-${i}`, qty: i % 5 });
  }
  return db;
}

async function collectRows<T>(iterator: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const row of iterator) out.push(row);
  return out;
}

test("sqlite exposes a native stream", () => {
  expect(typeof connectSqlite().stream).toBe("function");
});

test("cursor yields every row once, in order, matching get()", async () => {
  const db = await seeded(connectSqlite());
  const streamed = await collectRows(db.table("cursor_items").orderBy("id").cursor(4));
  const fetched = (await db.table("cursor_items").orderBy("id").get()).all();
  expect(streamed).toHaveLength(ROWS);
  expect(streamed).toEqual(fetched);
});

test("cursor honours where, bindings and limit", async () => {
  const db = await seeded(connectSqlite());
  const rows = await collectRows(
    db.table("cursor_items").where("qty", 3).orderBy("id").cursor(),
  );
  expect(rows.map((r) => r.qty)).toEqual([3, 3, 3, 3, 3]);

  const limited = await collectRows(
    db.table("cursor_items").orderBy("id").limit(7).cursor(),
  );
  expect(limited).toHaveLength(7);
});

test("cursor runs one query; lazy runs one per chunk", async () => {
  const db = await seeded(connectSqlite());
  const seen: string[] = [];
  listen((event) => seen.push(event.sql));

  await collectRows(db.table("cursor_items").orderBy("id").cursor(5));
  const cursorQueries = seen.length;
  seen.length = 0;
  await collectRows(db.table("cursor_items").orderBy("id").lazy(5));

  expect(cursorQueries).toBe(1);
  expect(seen.length).toBeGreaterThan(1);
});

test("abandoning the cursor early releases the statement", async () => {
  const connection = connectSqlite();
  const db = await seeded(connection);
  let taken = 0;
  for await (const _row of db.table("cursor_items").orderBy("id").cursor()) {
    if (++taken === 3) break;
  }
  expect(taken).toBe(3);
  // The same SQL still runs afterwards, and writes are not blocked.
  expect(await db.table("cursor_items").count()).toBe(ROWS);
  await db.table("cursor_items").where("id", 1).update({ name: "changed" });
  await connection.close();
});

test("writing to the table while streaming it works", async () => {
  const db = await seeded(connectSqlite());
  let seen = 0;
  for await (const row of db.table("cursor_items").orderBy("id").cursor(3)) {
    await db.table("cursor_items").where("id", row.id as number).update({ qty: 99 });
    seen++;
  }
  expect(seen).toBe(ROWS);
  expect(await db.table("cursor_items").where("qty", 99).count()).toBe(ROWS);
});

test("cursor/lazy return a LazyCollection you can chain", async () => {
  const { LazyCollection } = await import("@bunyad/common");
  const db = await seeded(connectSqlite());
  const cursor = db.table("cursor_items").orderBy("id").cursor(4);
  expect(cursor).toBeInstanceOf(LazyCollection);
  expect(db.table("cursor_items").lazy()).toBeInstanceOf(LazyCollection);

  const names = await db
    .table("cursor_items")
    .orderBy("id")
    .cursor(4)
    .filter((row) => row.qty === 0)
    .map((row) => row.name)
    .take(3)
    .toArray();
  expect(names).toEqual(["item-5", "item-10", "item-15"]);

  expect(await db.table("cursor_items").cursor().sum("qty")).toBe(
    (await db.table("cursor_items").get()).all().reduce((t, r) => t + Number(r.qty), 0),
  );
  expect(await db.table("cursor_items").orderBy("id").cursor().first()).toMatchObject({ id: 1 });
  const chunks = await db.table("cursor_items").orderBy("id").cursor(4).chunk(10).toArray();
  expect(chunks.map((c) => c.count())).toEqual([10, 10, 5]);
});

test("take() on a cursor stops pulling rows", async () => {
  const db = await seeded(connectSqlite());
  let seen = 0;
  const rows = await db
    .table("cursor_items")
    .orderBy("id")
    .cursor()
    .tap(() => void seen++)
    .take(5)
    .toArray();
  expect(rows).toHaveLength(5);
  expect(seen).toBe(5);
});

test("an empty result ends cleanly", async () => {
  const db = await seeded(connectSqlite());
  expect(await collectRows(db.table("cursor_items").where("id", -1).cursor())).toEqual([]);
});

test("a failing query surfaces the error from the iterator", async () => {
  const db = await seeded(connectSqlite());
  await expect(collectRows(db.table("missing_table").cursor())).rejects.toThrow();
});

test("cursor falls back to chunked paging when the driver cannot stream", async () => {
  const connection = connectSqlite();
  const db = await seeded(connection);
  const noStream = Object.create(connection, {
    stream: { value: undefined },
  }) as Connection;
  const fallback = new DatabaseManager(noStream);
  const rows = await collectRows(fallback.table("cursor_items").orderBy("id").cursor(6));
  expect(rows.map((r) => r.id)).toEqual(Array.from({ length: ROWS }, (_, i) => i + 1));
  void db;
});

test("stream is reported to query listeners once it finishes", async () => {
  const db = await seeded(connectSqlite());
  const events: { sql: string; timeMs: number }[] = [];
  listen((event) => events.push({ sql: event.sql, timeMs: event.timeMs }));
  await collectRows(db.table("cursor_items").cursor());
  expect(events).toHaveLength(1);
  expect(events[0]!.sql).toContain("cursor_items");
});

test("a read/write connection streams from the read side", async () => {
  const { createReadWriteConnection } = await import("./index.bun.ts");
  const write = connectSqlite();
  const rw = createReadWriteConnection(write, write, { sticky: false });
  expect(typeof rw.stream).toBe("function");
  const db = await seeded(rw);
  expect(await collectRows(db.table("cursor_items").cursor())).toHaveLength(ROWS);
});

const postgresUrl = process.env.BUNYAD_TEST_POSTGRES_URL;

const livePostgres = test.skipIf(!postgresUrl);

livePostgres("postgres cursor streams through a server-side cursor", async () => {
  const connection = connectPostgres({ url: postgresUrl!, max: 4 });
  try {
    expect(typeof connection.stream).toBe("function");
    await connection.exec("DROP TABLE IF EXISTS cursor_items_pg");
    const db = await seeded(connection, "cursor_items_pg");

    const streamed = await collectRows(db.table("cursor_items_pg").orderBy("id").cursor(4));
    expect(streamed).toHaveLength(ROWS);
    expect(streamed.map((r) => Number(r.id))).toEqual(
      Array.from({ length: ROWS }, (_, i) => i + 1),
    );

    // Bound parameters work through DECLARE.
    const filtered = await collectRows(
      db.table("cursor_items_pg").where("qty", 3).where("id", ">", 5).orderBy("id").cursor(2),
    );
    expect(filtered.map((r) => Number(r.id))).toEqual([8, 13, 18, 23]);

    // Early exit releases the reserved session and its transaction.
    let taken = 0;
    for await (const _row of db.table("cursor_items_pg").orderBy("id").cursor(3)) {
      if (++taken === 2) break;
    }
    expect(await db.table("cursor_items_pg").count()).toBe(ROWS);

    // Inside an open transaction the cursor reuses that session and sees its writes.
    await connection.transaction(async () => {
      await db.table("cursor_items_pg").insert({ name: "tx-row", qty: 7 });
      const rows = await collectRows(db.table("cursor_items_pg").where("qty", 7).cursor());
      expect(rows).toHaveLength(1);
    });

    // Chained, early-stopping use releases the session each time (pool is 4).
    for (let i = 0; i < 10; i++) {
      expect(await db.table("cursor_items_pg").orderBy("id").cursor(3).first()).not.toBeNull();
      expect(await db.table("cursor_items_pg").orderBy("id").cursor(3).take(2).count()).toBe(2);
    }

    // A failing query still frees the session.
    await expect(collectRows(db.table("no_such_table_pg").cursor())).rejects.toThrow();
    expect(await db.table("cursor_items_pg").count()).toBe(ROWS + 1);
  } finally {
    await connection.exec("DROP TABLE IF EXISTS cursor_items_pg").catch(() => undefined);
    await connection.close();
  }
});
