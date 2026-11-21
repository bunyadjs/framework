import { expect, test } from "bun:test";
import { DB, clearQueryListeners, connectSqlite, listen, setDefaultConnection } from "./index.ts";

async function setup() {
  clearQueryListeners();
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, tenant TEXT, qty INTEGER)");
  await connection.exec("INSERT INTO items (tenant, qty) VALUES ('a', 0), ('a', 3), ('b', 1)");
  return connection;
}

async function capture(run: () => Promise<unknown>): Promise<{ result: unknown; sql: string[] }> {
  const sql: string[] = [];
  const stop = listen((event) => sql.push(event.sql));
  try {
    return { result: await run(), sql };
  } finally {
    stop();
  }
}

test("exists() reads 1 from the first matching row instead of the whole row", async () => {
  const connection = await setup();

  const found = await capture(() => DB.table("items").where("tenant", "a").where("qty", ">", 0).exists());
  expect(found.result).toBe(true);
  expect(found.sql).toHaveLength(1);
  expect(found.sql[0]).toMatch(/^select 1 from/i);
  expect(found.sql[0]).toMatch(/limit 1$/i);

  const missing = await capture(() => DB.table("items").where("tenant", "c").exists());
  expect(missing.result).toBe(false);
  expect(missing.sql[0]).toMatch(/^select 1 from/i);

  expect(await DB.table("items").where("tenant", "b").doesntExist()).toBe(false);

  clearQueryListeners();
  await connection.close();
});

test("exists() keeps the select list a grouped or distinct query depends on", async () => {
  const connection = await setup();

  const grouped = await capture(() =>
    DB.table("items").select("tenant").groupBy("tenant").havingRaw("count(*) > 1").exists(),
  );
  expect(grouped.result).toBe(true);
  expect(grouped.sql[0]).not.toMatch(/^select 1 from/i);

  const distinct = await capture(() => DB.table("items").select("tenant").distinct().where("tenant", "z").exists());
  expect(distinct.result).toBe(false);
  expect(distinct.sql[0]).not.toMatch(/^select 1 from/i);

  clearQueryListeners();
  await connection.close();
});
