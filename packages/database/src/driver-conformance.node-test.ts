/**
 * N6 driver-conformance suite for Node drivers:
 * - Postgres (`pg` Pool) — live cases skip unless reachable
 * - SQLite (`better-sqlite3`) — in-memory, always online
 * - MySQL/MariaDB (`mysql2`) — live cases skip unless reachable
 *
 * Live Postgres: prefer `BUNYAD_TEST_POSTGRES_URL`, then `DATABASE_URL` / `DB_URL`,
 * then host/port defaults (`127.0.0.1:54329`).
 * Live MySQL: prefer `BUNYAD_TEST_MYSQL_URL`, then mysql:// `DATABASE_URL` / `DB_URL`.
 *
 * Run: `node --experimental-transform-types --test packages/database/src/driver-conformance.node-test.ts`
 *   or: `bun run --cwd packages/database test:node`
 *
 * Named `*.node-test.ts` (not `*.node.test.ts`) so `bun test` does not discover
 * these suites — better-sqlite3's NAPI addon can crash Bun's test runner.
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  connect,
  connectPostgres,
  connectMysql,
  connectSqlite,
  dialectFor,
  driverNameOf,
  createReadWriteConnection,
  DatabaseManager,
  schemaFor,
  lockClause,
  type Connection,
} from "./index.node.ts";
import { loadPg } from "./drivers/node/postgres.ts";
import { loadMysql2 } from "./drivers/node/mysql.ts";
import { loadBetterSqlite3 } from "./drivers/node/sqlite.ts";
import { affectedRowsFromResult } from "./connection-contract.ts";

/** Live-PG gate: `BUNYAD_TEST_POSTGRES_URL`, then `DATABASE_URL` / `DB_URL`. */
function postgresUrlFromEnv(): string | null {
  const url =
    process.env.BUNYAD_TEST_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.DB_URL;
  if (url && /^(postgres|postgresql):\/\//i.test(url)) return url;
  return null;
}

/** Live-MySQL gate: `BUNYAD_TEST_MYSQL_URL`, then mysql:// `DATABASE_URL` / `DB_URL`. */
function mysqlUrlFromEnv(): string | null {
  const url =
    process.env.BUNYAD_TEST_MYSQL_URL ??
    process.env.DATABASE_URL ??
    process.env.DB_URL;
  if (url && /^(mysql|mariadb):\/\//i.test(url)) return url;
  return null;
}

async function tryPostgres(): Promise<Connection | null> {
  const url = postgresUrlFromEnv();
  const connection = url
    ? connectPostgres({ url, max: 3 })
    : connectPostgres({
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 54329),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "bunyad",
        password: process.env.DB_PASSWORD ?? "bunyad",
        max: 3,
      });
  try {
    await connection.exec("SELECT 1");
    return connection;
  } catch {
    try {
      await connection.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function tryMysql(): Promise<Connection | null> {
  const url = mysqlUrlFromEnv();
  const connection = url
    ? connectMysql({ url, max: 3 })
    : connectMysql({
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        max: 3,
      });
  try {
    await connection.exec("SELECT 1");
    return connection;
  } catch {
    try {
      await connection.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

describe("Node peer fail-fast", () => {
  it("loadPg returns the pg module when installed", () => {
    const pg = loadPg();
    assert.equal(typeof pg.Pool, "function");
  });

  it("loadMysql2 returns mysql2/promise when installed", () => {
    const mysql = loadMysql2();
    assert.equal(typeof mysql.createPool, "function");
  });

  it("loadBetterSqlite3 returns better-sqlite3 when installed", () => {
    const Database = loadBetterSqlite3();
    assert.equal(typeof Database, "function");
  });
});

describe("Dialect / identity (no live DB)", () => {
  it("getDriverName / driverNameOf → pgsql / mysql / sqlite", () => {
    assert.equal(driverNameOf("postgres"), "pgsql");
    assert.equal(driverNameOf("mysql"), "mysql");
    assert.equal(driverNameOf("mariadb"), "mariadb");
    assert.equal(driverNameOf("sqlite"), "sqlite");
  });

  it("bindSql converts ? to $n for Postgres; MySQL keeps ?", () => {
    assert.equal(
      dialectFor("postgres").bindSql("SELECT * FROM t WHERE a = ? AND b = ?"),
      "SELECT * FROM t WHERE a = $1 AND b = $2",
    );
    assert.equal(
      dialectFor("mysql").bindSql("SELECT * FROM t WHERE a = ? AND b = ?"),
      "SELECT * FROM t WHERE a = ? AND b = ?",
    );
  });

  it("affectedRowsFromResult reads rowCount / affectedRows / changes", () => {
    assert.equal(affectedRowsFromResult({ rowCount: 4 }), 4);
    assert.equal(affectedRowsFromResult({ affectedRows: 2 }), 2);
    assert.equal(affectedRowsFromResult({ changes: 3 }), 3);
  });

  it("connect({ sqlite }) opens better-sqlite3 in-memory", async () => {
    const connection = connect({ driver: "sqlite", path: ":memory:" });
    assert.equal(connection.getDriverName(), "sqlite");
    assert.equal(typeof connection.getSync, "function");
    assert.equal(typeof connection.runSync, "function");
    assert.equal(typeof connection.insertGetIdSync, "function");
    await connection.exec("SELECT 1");
    await connection.close();
  });

  it("lockForUpdate / lockClause emits dialect FOR UPDATE (offline)", () => {
    assert.equal(lockClause("update", "postgres"), " FOR UPDATE");
    assert.equal(lockClause("shared", "postgres"), " FOR SHARE");
    assert.equal(lockClause("update", "sqlite"), "");
    assert.equal(lockClause("update", "mysql"), " FOR UPDATE");
    assert.equal(lockClause("shared", "mysql"), " LOCK IN SHARE MODE");

    const stub = {
      driver: "postgres",
      dialect: dialectFor("postgres"),
      raw: null,
      getDriverName: () => "pgsql",
      getName: () => "stub",
      setName() {
        return this as Connection;
      },
      getDatabaseName: () => "stub",
      getConfig: (() => ({})) as Connection["getConfig"],
      getPdo: () => null,
      async run() {
        return 0;
      },
      async get() {
        return null;
      },
      async all() {
        return [];
      },
      async exec() {},
      async insertGetId() {
        return 1;
      },
      async close() {},
      async transaction(cb: () => Promise<unknown>) {
        return cb();
      },
      async beginTransaction() {},
      async commit() {},
      async rollBack() {},
      afterCommit() {},
    } as Connection;

    const sql = new DatabaseManager(stub)
      .table("users")
      .where("id", 1)
      .lockForUpdate()
      .toSql();
    assert.match(sql, /FOR UPDATE\s*$/);
    assert.equal(
      new DatabaseManager(stub).table("users").sharedLock().toSql(),
      "SELECT * FROM users FOR SHARE",
    );
  });
});

describe("Read/write routing (in-memory stubs)", () => {
  it("routes reads and writes", async () => {
    const log: string[] = [];
    const stub = (name: string): Connection =>
      ({
        driver: "postgres",
        dialect: dialectFor("postgres"),
        raw: null,
        getDriverName: () => "pgsql",
        getName: () => name,
        setName() {
          return this as Connection;
        },
        getDatabaseName: () => "stub",
        getConfig: (() => ({})) as Connection["getConfig"],
        getPdo: () => null,
        async run(sql: string) {
          log.push(`${name}:run:${sql}`);
          return 1;
        },
        async get(sql: string) {
          log.push(`${name}:get:${sql}`);
          return { ok: true };
        },
        async all(sql: string) {
          log.push(`${name}:all:${sql}`);
          return [{ ok: true }];
        },
        async exec(sql: string) {
          log.push(`${name}:exec:${sql}`);
        },
        async insertGetId() {
          return 1;
        },
        async close() {},
        async transaction(cb) {
          return cb();
        },
        async beginTransaction() {},
        async commit() {},
        async rollBack() {},
        afterCommit() {},
      }) as Connection;

    const write = stub("write");
    const read = stub("read");
    const rw = createReadWriteConnection(write, read, { sticky: true });
    await rw.get("SELECT 1");
    await rw.run("UPDATE t");
    await rw.get("SELECT 2");
    assert.deepEqual(log, [
      "read:get:SELECT 1",
      "write:run:UPDATE t",
      "write:get:SELECT 2",
    ]);
  });
});

describe("Node SQLite better-sqlite3 (in-memory)", () => {
  it("run/get/all/exec + sync helpers parity", async () => {
    const connection = connectSqlite({ path: ":memory:" });
    const schema = schemaFor(connection);
    await schema.create("n6_sqlite_rows", (table) => {
      table.id();
      table.string("name");
    });

    assert.equal(
      connection.runSync!("INSERT INTO n6_sqlite_rows (name) VALUES (?)", [
        "alpha",
      ]),
      1,
    );
    const row = connection.getSync!<{ name: string }>(
      "SELECT name FROM n6_sqlite_rows WHERE name = ?",
      ["alpha"],
    );
    assert.equal(row?.name, "alpha");
    assert.equal(
      connection.allSync!<{ name: string }>("SELECT name FROM n6_sqlite_rows")
        .length,
      1,
    );

    const id = connection.insertGetIdSync!("n6_sqlite_rows", ["name"], ["beta"]);
    assert.ok(id > 0);
    const id1 = connection.insertGetIdSync1!("n6_sqlite_rows", "name", "gamma");
    assert.ok(id1 > id);
    const byId = connection.getSync1!<{ name: string }>(
      "SELECT name FROM n6_sqlite_rows WHERE id = ? LIMIT 1",
      id1,
    );
    assert.equal(byId?.name, "gamma");

    await connection.run("DELETE FROM n6_sqlite_rows WHERE name = ?", ["alpha"]);
    assert.equal(
      (await connection.all("SELECT * FROM n6_sqlite_rows")).length,
      2,
    );
    assert.equal(connection.getDriverName(), "sqlite");
    await connection.close();
  });

  it("bind coercion: undefined→null, Date→SQL text", async () => {
    const connection = connectSqlite({ path: ":memory:" });
    const schema = schemaFor(connection);
    await schema.create("n6_sqlite_binds", (table) => {
      table.id();
      table.string("label").nullable();
      table.timestamp("ts").nullable();
    });
    const when = new Date("2026-09-30T07:00:00.000Z");
    await connection.run(
      "INSERT INTO n6_sqlite_binds (label, ts) VALUES (?, ?)",
      [undefined, when],
    );
    const row = await connection.get<{
      label: string | null;
      ts: string | null;
    }>("SELECT label, ts FROM n6_sqlite_binds LIMIT 1");
    assert.equal(row?.label, null);
    assert.match(String(row?.ts), /2026-09-30/);
    await connection.close();
  });

  it("nested txn + afterCommit", async () => {
    const connection = connectSqlite({ path: ":memory:" });
    const schema = schemaFor(connection);
    await schema.create("n6_sqlite_tx", (table) => {
      table.id();
      table.integer("balance");
    });
    const db = new DatabaseManager(connection);
    await db.table("n6_sqlite_tx").insert({ balance: 100 });

    await connection.transaction(async () => {
      await db.table("n6_sqlite_tx").where("id", 1).update({ balance: 80 });
      await assert.rejects(
        connection.transaction(async () => {
          await db.table("n6_sqlite_tx").where("id", 1).update({ balance: 1 });
          throw new Error("inner-fail");
        }),
        /inner-fail/,
      );
      assert.equal((await db.table("n6_sqlite_tx").first())?.balance, 80);
    });
    assert.equal((await db.table("n6_sqlite_tx").first())?.balance, 80);

    const order: string[] = [];
    await connection.transaction(async () => {
      connection.afterCommit(() => {
        order.push("ok");
      });
    });
    assert.deepEqual(order, ["ok"]);
    await assert.rejects(
      connection.transaction(async () => {
        connection.afterCommit(() => {
          order.push("nope");
        });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.deepEqual(order, ["ok"]);
    await connection.close();
  });
});

describe("Node Postgres live (skip unless BUNYAD_TEST_POSTGRES_URL / DATABASE_URL reachable)", async () => {
  let connection: Connection | null = null;

  before(async () => {
    connection = await tryPostgres();
  });

  after(async () => {
    if (connection) await connection.close();
  });

  it("run/get/all/exec + affectedRows parity", async (t) => {
    if (!connection) {
      t.skip("Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL");
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_rows");
    await schema.create("n6_rows", (table) => {
      table.id();
      table.string("name");
    });
    const inserted = await connection.run(
      "INSERT INTO n6_rows (name) VALUES (?)",
      ["alpha"],
    );
    assert.equal(inserted, 1);
    const row = await connection.get<{ name: string }>(
      "SELECT name FROM n6_rows WHERE name = ?",
      ["alpha"],
    );
    assert.equal(row?.name, "alpha");
    const all = await connection.all<{ name: string }>(
      "SELECT name FROM n6_rows",
    );
    assert.equal(all.length, 1);
    await connection.exec("DELETE FROM n6_rows");
    assert.equal(
      (await connection.all("SELECT * FROM n6_rows")).length,
      0,
    );
    await schema.dropIfExists("n6_rows");
  });

  it("bind coercion: undefined→null, Date→ISO storage", async (t) => {
    if (!connection) {
      t.skip("Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL");
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_binds");
    await schema.create("n6_binds", (table) => {
      table.id();
      table.string("label").nullable();
      table.timestamp("ts").nullable();
    });
    const when = new Date("2026-09-30T07:00:00.000Z");
    await connection.run(
      "INSERT INTO n6_binds (label, ts) VALUES (?, ?)",
      [undefined, when],
    );
    const row = await connection.get<{ label: string | null; ts: Date | string }>(
      "SELECT label, ts FROM n6_binds LIMIT 1",
    );
    assert.equal(row?.label, null);
    const ts =
      row?.ts instanceof Date ? row.ts.toISOString() : String(row?.ts);
    assert.match(ts, /2026-09-30/);
    await schema.dropIfExists("n6_binds");
  });

  it("insertGetId + RETURNING", async (t) => {
    if (!connection) {
      t.skip("Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL");
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_ids");
    await schema.create("n6_ids", (table) => {
      table.id();
      table.string("name");
    });
    const id = await connection.insertGetId("n6_ids", ["name"], ["x"]);
    assert.equal(typeof id, "number");
    assert.ok(id > 0);
    assert.equal(connection.getDriverName(), "pgsql");
    const pool = connection.getPdo() as { options?: { max?: number } };
    // Pool.max from connect options
    assert.equal(connection.getConfig("max"), 3);
    void pool;
    await schema.dropIfExists("n6_ids");
  });

  it("nested txn + concurrent outer txns", async (t) => {
    if (!connection) {
      t.skip("Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL");
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_tx");
    await schema.create("n6_tx", (table) => {
      table.id();
      table.integer("balance");
    });
    const db = new DatabaseManager(connection);
    await db.table("n6_tx").insert({ balance: 100 });

    await connection.transaction(async () => {
      await db.table("n6_tx").where("id", 1).update({ balance: 80 });
      await assert.rejects(
        connection!.transaction(async () => {
          await db.table("n6_tx").where("id", 1).update({ balance: 1 });
          throw new Error("inner-fail");
        }),
        /inner-fail/,
      );
      assert.equal((await db.table("n6_tx").first())?.balance, 80);
    });
    assert.equal((await db.table("n6_tx").first())?.balance, 80);

    await Promise.all([
      connection.transaction(async () => {
        await db.table("n6_tx").insert({ balance: 2 });
      }),
      connection.transaction(async () => {
        await db.table("n6_tx").insert({ balance: 3 });
      }),
    ]);
    assert.equal(await db.table("n6_tx").count(), 3);
    await schema.dropIfExists("n6_tx");
  });

  it("afterCommit runs only on successful commit", async (t) => {
    if (!connection) {
      t.skip("Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL");
      return;
    }
    const order: string[] = [];
    await connection.transaction(async () => {
      connection!.afterCommit(() => {
        order.push("ok");
      });
    });
    assert.deepEqual(order, ["ok"]);

    await assert.rejects(
      connection.transaction(async () => {
        connection!.afterCommit(() => {
          order.push("nope");
        });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.deepEqual(order, ["ok"]);
  });
});

describe("Node MySQL live (skip unless BUNYAD_TEST_MYSQL_URL / mysql DATABASE_URL reachable)", async () => {
  let connection: Connection | null = null;

  before(async () => {
    connection = await tryMysql();
  });

  after(async () => {
    if (connection) await connection.close();
  });

  it("run/get/all/exec + insertGetId", async (t) => {
    if (!connection) {
      t.skip(
        "MySQL unavailable — set BUNYAD_TEST_MYSQL_URL (or mysql:// DATABASE_URL) to a reachable URL",
      );
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_mysql_rows");
    await schema.create("n6_mysql_rows", (table) => {
      table.id();
      table.string("name");
    });
    const inserted = await connection.run(
      "INSERT INTO n6_mysql_rows (name) VALUES (?)",
      ["alpha"],
    );
    assert.equal(inserted, 1);
    const row = await connection.get<{ name: string }>(
      "SELECT name FROM n6_mysql_rows WHERE name = ?",
      ["alpha"],
    );
    assert.equal(row?.name, "alpha");
    const id = await connection.insertGetId("n6_mysql_rows", ["name"], ["beta"]);
    assert.ok(id > 0);
    assert.equal(connection.getDriverName(), "mysql");
    assert.equal(connection.getConfig("max"), 3);
    await schema.dropIfExists("n6_mysql_rows");
  });

  it("nested txn + concurrent outer txns", async (t) => {
    if (!connection) {
      t.skip(
        "MySQL unavailable — set BUNYAD_TEST_MYSQL_URL (or mysql:// DATABASE_URL) to a reachable URL",
      );
      return;
    }
    const schema = schemaFor(connection);
    await schema.dropIfExists("n6_mysql_tx");
    await schema.create("n6_mysql_tx", (table) => {
      table.id();
      table.integer("balance");
    });
    const db = new DatabaseManager(connection);
    await db.table("n6_mysql_tx").insert({ balance: 100 });

    await connection.transaction(async () => {
      await db.table("n6_mysql_tx").where("id", 1).update({ balance: 80 });
      await assert.rejects(
        connection!.transaction(async () => {
          await db.table("n6_mysql_tx").where("id", 1).update({ balance: 1 });
          throw new Error("inner-fail");
        }),
        /inner-fail/,
      );
      assert.equal((await db.table("n6_mysql_tx").first())?.balance, 80);
    });
    assert.equal((await db.table("n6_mysql_tx").first())?.balance, 80);

    await Promise.all([
      connection.transaction(async () => {
        await db.table("n6_mysql_tx").insert({ balance: 2 });
      }),
      connection.transaction(async () => {
        await db.table("n6_mysql_tx").insert({ balance: 3 });
      }),
    ]);
    assert.equal(await db.table("n6_mysql_tx").count(), 3);
    await schema.dropIfExists("n6_mysql_tx");
  });

  it("afterCommit runs only on successful commit", async (t) => {
    if (!connection) {
      t.skip(
        "MySQL unavailable — set BUNYAD_TEST_MYSQL_URL (or mysql:// DATABASE_URL) to a reachable URL",
      );
      return;
    }
    const order: string[] = [];
    await connection.transaction(async () => {
      connection!.afterCommit(() => {
        order.push("ok");
      });
    });
    assert.deepEqual(order, ["ok"]);
    await assert.rejects(
      connection.transaction(async () => {
        connection!.afterCommit(() => {
          order.push("nope");
        });
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.deepEqual(order, ["ok"]);
  });
});
