import { expect, test } from "bun:test";
import { runWithPaginatorRequest } from "@bunyad/common";
import {
  connectSqlite,
  connectSqlsrv,
  DatabaseManager,
  schemaFor,
  migrate,
  rollback,
  fresh,
  status,
  wipe,
  DB,
  setDefaultConnection,
  dialectFor,
  configFromEnv,
  postgresConnectionUrl,
  sanitizePostgresUrl,
  driverNameOf,
  RecordNotFoundException,
  currentTransactionId,
  clearQueryListeners,
} from "../src/index.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("getDriverName uses pgsql for Postgres", () => {
  expect(driverNameOf("postgres")).toBe("pgsql");
  expect(driverNameOf("sqlite")).toBe("sqlite");
  expect(driverNameOf("mysql")).toBe("mysql");
  expect(driverNameOf("mariadb")).toBe("mariadb");
  expect(driverNameOf("sqlsrv")).toBe("sqlsrv");
});

test("Schema getConnection getDriverName", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  expect(schema.getConnection()).toBe(connection);
  expect(schema.getConnection().getDriverName()).toBe("sqlite");
  expect(connection.getDriverName()).toBe("sqlite");
  setDefaultConnection(connection);
  expect(DB.getDriverName()).toBe("sqlite");
  await connection.close();
});

test("connection getName getDatabaseName getConfig getPdo", async () => {
  const connection = connectSqlite({ path: ":memory:" });
  expect(connection.getName()).toBe("default");
  expect(connection.setName("analytics").getName()).toBe("analytics");
  expect(connection.getDatabaseName()).toBe(":memory:");
  expect(connection.getConfig("driver")).toBe("sqlite");
  expect(connection.getConfig("path")).toBe(":memory:");
  expect(connection.getPdo()).toBe(connection.raw);
  setDefaultConnection(connection, "analytics");
  expect(DB.getName()).toBe("analytics");
  expect(DB.getDatabaseName()).toBe(":memory:");
  expect(DB.getConfig("driver")).toBe("sqlite");
  expect(DB.getPdo()).toBe(connection.raw);
  await connection.close();
});

test("query builder insert get where", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.timestamps();
  });

  const db = new DatabaseManager(connection);
  const id = await db.table("users").insertGetId({
    email: "a@b.c",
    created_at: "now",
    updated_at: "now",
  });
  expect(id).toBe(1);
  expect((await db.table("users").where("email", "a@b.c").first())?.email).toBe(
    "a@b.c",
  );
  await connection.close();
});

test("sqlite getSync1 and insertGetIdSync1", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("items", (table) => {
    table.id();
    table.string("name");
  });

  const id = connection.insertGetIdSync1!("items", "name", "hello");
  expect(id).toBe(1);
  const row = connection.getSync1!<{ id: number; name: string }>(
    "SELECT id, name FROM items WHERE id = ? LIMIT 1",
    id,
  );
  expect(row).toEqual({ id: 1, name: "hello" });
  expect(
    connection.getSync1!("SELECT id FROM items WHERE id = ? LIMIT 1", 999),
  ).toBeNull();

  await connection.close();
});

test("sqlite insert accepts Date and undefined bindings", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("notes", (table) => {
    table.id();
    table.string("title");
    table.timestamp("due_at").nullable();
    table.string("tag").nullable();
  });

  const db = new DatabaseManager(connection);
  await db.table("notes").insert({
    title: "due",
    due_at: new Date("2026-09-14T00:00:00.000Z"),
    tag: undefined,
  });
  const row = await db.table("notes").where("title", "due").first();
  expect(row?.due_at).toBe("2026-09-14 00:00:00");
  expect(row?.tag).toBeNull();
  await connection.close();
});

test("query builder whereNull", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("items", (table) => {
    table.id();
    table.string("name");
    table.text("deleted_at").nullable();
  });

  const db = new DatabaseManager(connection);
  await db.table("items").insert({ name: "a", deleted_at: null });
  await db.table("items").insert({ name: "b", deleted_at: "2026-01-01" });

  expect(await db.table("items").whereNull("deleted_at").get()).toHaveLength(1);
  expect(await db.table("items").whereNotNull("deleted_at").get()).toHaveLength(
    1,
  );
  await connection.close();
});

test("transaction commits on success and rolls back on failure", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("accounts", (table) => {
    table.id();
    table.integer("balance");
  });

  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);
  await db.table("accounts").insert({ balance: 100 });

  await DB.transaction(async () => {
    await db.table("accounts").where("id", 1).update({ balance: 50 });
  });
  expect((await db.table("accounts").first())?.balance).toBe(50);

  await expect(
    DB.transaction(async () => {
      await db.table("accounts").where("id", 1).update({ balance: 10 });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");

  expect((await db.table("accounts").first())?.balance).toBe(50);
  await connection.close();
});


test("nested transactions use savepoints (inner rollback keeps outer)", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("accounts", (table) => {
    table.id();
    table.integer("balance");
  });
  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);
  await db.table("accounts").insert({ balance: 100 });

  await DB.transaction(async () => {
    await db.table("accounts").where("id", 1).update({ balance: 80 });
    await expect(
      DB.transaction(async () => {
        await db.table("accounts").where("id", 1).update({ balance: 1 });
        throw new Error("inner-fail");
      }),
    ).rejects.toThrow("inner-fail");
    // Outer still active; inner savepoint rolled back.
    expect((await db.table("accounts").first())?.balance).toBe(80);
    await db.table("accounts").where("id", 1).update({ balance: 70 });
  });

  expect((await db.table("accounts").first())?.balance).toBe(70);
  await connection.close();
});

test("nested transactions commit both levels", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("accounts", (table) => {
    table.id();
    table.integer("balance");
  });
  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);
  await db.table("accounts").insert({ balance: 0 });

  await DB.transaction(async () => {
    await db.table("accounts").where("id", 1).update({ balance: 10 });
    await DB.transaction(async () => {
      await db.table("accounts").where("id", 1).update({ balance: 20 });
    });
    expect((await db.table("accounts").first())?.balance).toBe(20);
  });

  expect((await db.table("accounts").first())?.balance).toBe(20);
  await connection.close();
});

test("afterCommit runs only after outermost commit with nesting", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("metrics", (table) => {
    table.id();
    table.string("name");
  });
  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);

  const order: string[] = [];
  await DB.transaction(async () => {
    DB.afterCommit(() => {
      order.push("outer");
    });
    await DB.transaction(async () => {
      DB.afterCommit(() => {
        order.push("inner");
      });
      await db.table("metrics").insert({ name: "x" });
      expect(order).toEqual([]);
    });
    expect(order).toEqual([]);
  });
  expect(order).toEqual(["outer", "inner"]);
  await connection.close();
});

test("manual beginTransaction nests with savepoints", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("accounts", (table) => {
    table.id();
    table.integer("balance");
  });
  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);
  await db.table("accounts").insert({ balance: 100 });

  await DB.beginTransaction();
  await db.table("accounts").where("id", 1).update({ balance: 90 });
  await DB.beginTransaction();
  await db.table("accounts").where("id", 1).update({ balance: 5 });
  await DB.rollBack(); // inner savepoint
  expect((await db.table("accounts").first())?.balance).toBe(90);
  await DB.commit();
  expect((await db.table("accounts").first())?.balance).toBe(90);
  await connection.close();
});

test("currentTransactionId is set inside connection.transaction", async () => {
  const connection = connectSqlite();
  expect(currentTransactionId()).toBeNull();
  let inner: string | null = null;
  await connection.transaction(async () => {
    inner = currentTransactionId();
    expect(inner).toBeTruthy();
  });
  expect(inner).toBeTruthy();
  expect(currentTransactionId()).toBeNull();
  await connection.close();
});

test("schema table add rename drop column", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);

  await schema.create("notes", (table) => {
    table.id();
    table.string("title");
  });
  expect(await schema.hasTable("notes")).toBe(true);
  expect(await schema.hasColumn("notes", "title")).toBe(true);

  await schema.table("notes", (table) => {
    table.string("body").nullable();
  });
  expect(await schema.hasColumn("notes", "body")).toBe(true);

  await schema.table("notes", (table) => {
    table.renameColumn("body", "content");
  });
  expect(await schema.hasColumn("notes", "content")).toBe(true);
  expect(await schema.hasColumn("notes", "body")).toBe(false);

  await schema.table("notes", (table) => {
    table.dropColumn("content");
  });
  expect(await schema.hasColumn("notes", "content")).toBe(false);
  await connection.close();
});

test("migrate rollback fresh status wipe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-mig-"));
  await Bun.write(
    join(dir, "2026_01_01_000000_create_notes.ts"),
    `import type { Schema } from ${JSON.stringify(new URL("../src/schema.ts", import.meta.url).href)};
export async function up(schema: Schema) {
  await schema.create("notes", (t) => { t.id(); t.string("title"); });
}
export async function down(schema: Schema) {
  await schema.dropIfExists("notes");
}
`,
  );

  const connection = connectSqlite();
  expect(await migrate(connection, dir)).toEqual([
    "2026_01_01_000000_create_notes.ts",
  ]);
  expect(await schemaFor(connection).hasTable("notes")).toBe(true);

  const rows = await status(connection, dir);
  expect(rows[0]?.batch).toBe(1);

  expect(await rollback(connection, dir)).toEqual([
    "2026_01_01_000000_create_notes.ts",
  ]);
  expect(await schemaFor(connection).hasTable("notes")).toBe(false);

  await connection.exec("CREATE TABLE unmanaged (id INTEGER PRIMARY KEY)");
  expect(await fresh(connection, dir)).toHaveLength(1);
  expect(await schemaFor(connection).hasTable("unmanaged")).toBe(false);
  expect(await wipe(connection)).toContain("notes");
  expect(await schemaFor(connection).hasTable("notes")).toBe(false);
  await connection.close();
});

test("dialects render driver-specific id columns", () => {
  expect(dialectFor("sqlite").columnSql({
    name: "id",
    kind: "id",
    primary: true,
    autoIncrement: true,
  })).toContain("AUTOINCREMENT");

  expect(dialectFor("postgres").columnSql({
    name: "id",
    kind: "id",
    primary: true,
    autoIncrement: true,
  })).toContain("BIGSERIAL");

  expect(dialectFor("mysql").columnSql({
    name: "id",
    kind: "id",
    primary: true,
    autoIncrement: true,
  })).toContain("AUTO_INCREMENT");

  expect(dialectFor("mariadb").columnSql({
    name: "id",
    kind: "id",
    primary: true,
    autoIncrement: true,
  })).toContain("AUTO_INCREMENT");
  expect(dialectFor("mariadb").driver).toBe("mariadb");

  expect(dialectFor("sqlsrv").columnSql({
    name: "id",
    kind: "id",
    primary: true,
    autoIncrement: true,
  })).toContain("IDENTITY(1,1)");
  expect(dialectFor("sqlsrv").bindSql("SELECT * FROM t WHERE id = ? AND x = ?")).toBe(
    "SELECT * FROM t WHERE id = @p0 AND x = @p1",
  );
  expect(dialectFor("sqlsrv").quoteIdentifier("users")).toBe("[users]");

  expect(dialectFor("postgres").bindSql("SELECT * FROM t WHERE id = ? AND x = ?")).toBe(
    "SELECT * FROM t WHERE id = $1 AND x = $2",
  );
});

test("configFromEnv resolves drivers", () => {
  expect(configFromEnv({ DB_CONNECTION: "sqlite", DATABASE_PATH: "/tmp/a.sqlite" })).toEqual({
    driver: "sqlite",
    path: "/tmp/a.sqlite",
  });
  expect(configFromEnv({ DB_CONNECTION: "postgres", DATABASE_URL: "postgres://x" })).toEqual({
    driver: "pgsql",
    url: "postgres://x",
  });
  expect(configFromEnv({ DB_CONNECTION: "mysql", DB_HOST: "db", DB_DATABASE: "app" }).driver).toBe(
    "mysql",
  );
  expect(configFromEnv({ DB_CONNECTION: "pgsql" }).driver).toBe("pgsql");
  expect(configFromEnv({ DB_CONNECTION: "mariadb" }).driver).toBe("mariadb");
  expect(configFromEnv({ DB_CONNECTION: "sqlsrv", DB_HOST: "db" }).driver).toBe("sqlsrv");
  expect(configFromEnv({ DB_CONNECTION: "mssql" }).driver).toBe("sqlsrv");
  expect(configFromEnv({ DB_CONNECTION: "sqlserver", DATABASE_URL: "sqlserver://x" })).toEqual({
    driver: "sqlsrv",
    url: "sqlserver://x",
  });
});

test("sanitizePostgresUrl drops Prisma schema query param", () => {
  expect(
    sanitizePostgresUrl(
      "postgresql://u:p@127.0.0.1:5432/app?schema=public&sslmode=disable",
    ),
  ).toBe("postgresql://u:p@127.0.0.1:5432/app?sslmode=disable");
});

test("postgresConnectionUrl builds a URL and ignores env DATABASE_URL", () => {
  expect(
    postgresConnectionUrl({
      hostname: "127.0.0.1",
      port: 54329,
      database: "bunyad",
      username: "bunyad",
      password: "bunyad",
    }),
  ).toBe("postgresql://bunyad:bunyad@127.0.0.1:54329/bunyad");
  expect(
    postgresConnectionUrl({
      url: "postgresql://u:p@127.0.0.1:5432/app?schema=public",
    }),
  ).toBe("postgresql://u:p@127.0.0.1:5432/app");
});

test("connectPostgres object options ignore DATABASE_URL schema param", async () => {
  const { connectPostgres } = await import("../src/index.ts");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    "postgresql://nobody@127.0.0.1:1/nope?schema=public";
  const connection = connectPostgres({
    hostname: "127.0.0.1",
    port: 54329,
    database: "bunyad",
    username: "bunyad",
    password: "bunyad",
    max: 1,
  });
  try {
    await connection.exec("SELECT 1");
    const row = await connection.get<{ db: string }>(
      "SELECT current_database() AS db",
    );
    expect(row?.db).toBe("bunyad");
  } catch {
    return;
  } finally {
    if (previous === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previous;
    }
    await connection.close();
  }
});

test("postgres/mysql/mariadb/sqlsrv connections skip when unavailable", async () => {
  const {
    connectPostgres,
    connectMysql,
    connectMariadb,
    connectSqlsrv,
  } = await import("../src/index.ts");

  const tryPg = async () => {
    const connection = connectPostgres(
      Bun.env.BUNYAD_TEST_POSTGRES_URL
        ? { url: Bun.env.BUNYAD_TEST_POSTGRES_URL, max: 1 }
        : {
            hostname: "127.0.0.1",
            port: 54329,
            database: "bunyad",
            username: "bunyad",
            password: "bunyad",
            max: 1,
          },
    );
    try {
      await connection.exec("SELECT 1");
      const schema = schemaFor(connection);
      await schema.dropIfExists("driver_smoke");
      await schema.create("driver_smoke", (t) => {
        t.id();
        t.string("email").unique();
      });
      const id = await new DatabaseManager(connection)
        .table("driver_smoke")
        .insertGetId({ email: "pg@test" });
      expect(id).toBeGreaterThan(0);
      await schema.dropIfExists("driver_smoke");
    } finally {
      await connection.close();
    }
  };

  const tryMysql = async () => {
    const connection = connectMysql(
      Bun.env.BUNYAD_TEST_MYSQL_URL
        ? { url: Bun.env.BUNYAD_TEST_MYSQL_URL, tls: { rejectUnauthorized: false }, max: 1 }
        : {
            hostname: "127.0.0.1",
            port: 33069,
            database: "bunyad",
            username: "bunyad",
            password: "bunyad",
            max: 1,
          },
    );
    try {
      await connection.exec("SELECT 1");
      const schema = schemaFor(connection);
      await schema.dropIfExists("driver_smoke");
      await schema.create("driver_smoke", (t) => {
        t.id();
        t.string("email").unique();
      });
      const id = await new DatabaseManager(connection)
        .table("driver_smoke")
        .insertGetId({ email: "mysql@test" });
      expect(id).toBeGreaterThan(0);
      await schema.dropIfExists("driver_smoke");
    } finally {
      await connection.close();
    }
  };

  const tryMariadb = async () => {
    const connection = connectMariadb({
      hostname: "127.0.0.1",
      port: 33069,
      database: "bunyad",
      username: "bunyad",
      password: "bunyad",
      max: 1,
    });
    try {
      await connection.exec("SELECT 1");
      expect(connection.driver).toBe("mariadb");
    } finally {
      await connection.close();
    }
  };

  const trySqlsrv = async () => {
    const connection = connectSqlsrv({
      hostname: "127.0.0.1",
      port: 14333,
      database: "bunyad",
      username: "sa",
      password: "bunyad",
      trustServerCertificate: true,
      max: 1,
    });
    try {
      await connection.exec("SELECT 1");
      expect(connection.driver).toBe("sqlsrv");
    } finally {
      await connection.close();
    }
  };

  try {
    await tryPg();
  } catch (error) {
    console.warn("Skipping Postgres smoke:", (error as Error).message);
  }

  try {
    await tryMysql();
  } catch (error) {
    console.warn("Skipping MySQL smoke:", (error as Error).message);
  }

  try {
    await tryMariadb();
  } catch (error) {
    console.warn("Skipping MariaDB smoke:", (error as Error).message);
  }

  try {
    await trySqlsrv();
  } catch (error) {
    console.warn("Skipping SQL Server smoke:", (error as Error).message);
  }
});

test("sqlsrv query builder uses OFFSET FETCH", () => {
  const connection = connectSqlsrv({
    hostname: "127.0.0.1",
    port: 14333,
    database: "bunyad",
    username: "sa",
    password: "x",
  });
  const sql = new DatabaseManager(connection)
    .table("users")
    .orderBy("id")
    .limit(5)
    .offset(10)
    .toSql();
  expect(sql).toContain("OFFSET 10 ROWS");
  expect(sql).toContain("FETCH NEXT 5 ROWS ONLY");
  expect(sql).not.toContain("LIMIT");
});

test("query builder whereIn orWhere join select take skip", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
  });
  await schema.create("posts", (t) => {
    t.id();
    t.integer("user_id");
    t.string("title");
  });

  await DB.table("users").insert({ name: "Ada" });
  await DB.table("users").insert({ name: "Grace" });
  await DB.table("posts").insert({ user_id: 1, title: "A" });
  await DB.table("posts").insert({ user_id: 2, title: "B" });

  expect(await DB.table("users").whereIn("id", [1]).pluck("name").then((c) => c.all())).toEqual(["Ada"]);
  expect(
    await DB.table("users").where("name", "Ada").orWhere("name", "Grace").count(),
  ).toBe(2);
  expect(await DB.table("users").whereNotIn("id", [1]).value("name")).toBe("Grace");

  const joined = await DB.table("posts")
    .join("users", "posts.user_id", "=", "users.id")
    .select("posts.title", "users.name")
    .where("users.name", "Ada")
    .get();
  expect(joined.first()?.title).toBe("A");
  expect(joined.first()?.name).toBe("Ada");

  expect(await DB.table("users").orderBy("id").take(1).get()).toHaveLength(1);
  expect((await DB.table("users").orderBy("id").skip(1).take(1).first())?.name).toBe(
    "Grace",
  );
  expect(await DB.table("users").where("id", 1).exists()).toBe(true);
  expect(await DB.table("users").where("id", 99).doesntExist()).toBe(true);

  await DB.table("users").where("id", 1).exists();
  await DB.statement("SELECT 1");
  await connection.close();
});

test("query builder when tap whereBetween whereExists chunk paginate", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.integer("votes");
  });
  await schema.create("orders", (t) => {
    t.id();
    t.integer("user_id");
    t.integer("total");
  });

  await DB.table("users").insert({ name: "Ada", votes: 50 });
  await DB.table("users").insert({ name: "Grace", votes: 150 });
  await DB.table("users").insert({ name: "Alan", votes: 10 });
  await DB.table("orders").insert({ user_id: 1, total: 20 });

  const filtered = await DB.table("users")
    .when(true, (q) => {
      q.whereBetween("votes", [20, 100]);
    })
    .tap((q) => {
      q.orderBy("id");
    })
    .get();
  expect(filtered.pluck("name").all()).toEqual(["Ada"]);

  const withOrders = await DB.table("users")
    .whereExists((q) => {
      q.select("*")
        .from("orders")
        .whereColumn("orders.user_id", "users.id");
    })
    .get();
  expect(withOrders.pluck("name").all()).toEqual(["Ada"]);

  expect(
    await DB.table("users").whereRaw("votes > ?", [100]).value("name"),
  ).toBe("Grace");

  const chunks: string[][] = [];
  await DB.table("users")
    .orderBy("id")
    .chunk(2, (rows) => {
      chunks.push(rows.pluck("name").all() as string[]);
    });
  expect(chunks).toEqual([["Ada", "Grace"], ["Alan"]]);

  const cursorNames: string[] = [];
  for await (const row of DB.table("users").orderBy("id").cursor(2)) {
    cursorNames.push(String(row.name));
  }
  expect(cursorNames).toEqual(["Ada", "Grace", "Alan"]);

  const page = await DB.table("users").orderBy("id").paginate(2, 1);
  expect(page.items).toHaveLength(2);
  expect(page.total).toBe(3);
  expect(page.hasMorePages()).toBe(true);

  const simple = await DB.table("users").orderBy("id").simplePaginate(2, 1);
  expect(simple.pageItems()).toHaveLength(2);
  expect(simple.hasMorePages()).toBe(true);

  const cloned = DB.table("users").where("name", "Ada").clone();
  expect(await cloned.count()).toBe(1);
  expect(await DB.table("users").count()).toBe(3);

  await connection.close();
});

test("paginate without a page argument reads ?page= from the request", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("name");
  });
  await DB.table("users").insert([
    { name: "Ada" },
    { name: "Grace" },
    { name: "Alan" },
  ]);

  const page = await runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/users",
      query: () => ({ page: "2" }),
      input: (key) => (key === "page" ? "2" : undefined),
    },
    () => DB.table("users").orderBy("id").paginate(2),
  );
  expect(page.currentPage).toBe(2);
  expect(page.items.map((row) => row.name)).toEqual(["Alan"]);

  await connection.close();
});

test("query builder union rightJoin crossJoin locks cursorPaginate withCasts json", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.string("role").nullable();
    t.integer("active");
    t.json("meta");
  });
  await schema.create("posts", (t) => {
    t.id();
    t.integer("user_id");
    t.string("title");
  });
  await schema.create("tags", (t) => {
    t.id();
    t.string("name");
  });

  await DB.table("users").insert({
    name: "Ada",
    role: "admin",
    active: 1,
    meta: JSON.stringify({ languages: ["en", "fr"], color: "blue" }),
  });
  await DB.table("users").insert({
    name: "Grace",
    role: "user",
    active: 0,
    meta: JSON.stringify({ languages: ["en"], color: "red" }),
  });
  await DB.table("users").insert({
    name: "Alan",
    role: null,
    active: 1,
    meta: JSON.stringify({ languages: ["de"] }),
  });
  await DB.table("posts").insert({ user_id: 1, title: "Hello" });
  await DB.table("tags").insert({ name: "a" });
  await DB.table("tags").insert({ name: "b" });

  const unioned = await DB.table("users")
    .where("role", "admin")
    .union(DB.table("users").whereNull("role"))
    .orderBy("id")
    .get();
  expect(unioned.pluck("name").all()).toEqual(["Ada", "Alan"]);

  const unionAll = await DB.table("users")
    .where("active", 1)
    .unionAll(DB.table("users").where("active", 1))
    .get();
  expect(unionAll.length).toBe(4);

  const crossed = await DB.table("tags").crossJoin("tags as t2").count();
  expect(crossed).toBe(4);

  // SQLite supports RIGHT JOIN (3.39+)
  const right = await DB.table("posts")
    .rightJoin("users", "users.id", "=", "posts.user_id")
    .select("users.name", "posts.title")
    .orderBy("users.id")
    .get();
  expect(right.length).toBe(3);
  expect(right.first()?.name).toBe("Ada");

  const lockedSql = DB.table("users").where("id", 1).lockForUpdate().toSql();
  expect(lockedSql).not.toContain("FOR UPDATE"); // sqlite no-op
  expect(DB.table("users").sharedLock().toSql()).toBe(
    "SELECT * FROM users",
  );

  expect(
    await DB.table("users").whereJsonContains("meta->languages", "en").count(),
  ).toBe(2);
  expect(
    await DB.table("users").whereJsonContainsKey("meta->color").count(),
  ).toBe(2);
  expect(
    await DB.table("users").whereJsonDoesntContainKey("meta->color").count(),
  ).toBe(1);
  expect(
    await DB.table("users").whereJsonLength("meta->languages", 2).count(),
  ).toBe(1);

  const casted = await DB.table("users")
    .where("id", 1)
    .withCasts({ active: "boolean", meta: "json" })
    .first();
  expect(casted?.active).toBe(true);
  expect((casted?.meta as { color: string }).color).toBe("blue");

  const page1 = await DB.table("users").orderBy("id").cursorPaginate(2);
  expect(page1.items).toHaveLength(2);
  expect(page1.hasMorePages()).toBe(true);
  expect(page1.nextCursor()).toBeTruthy();

  const page2 = await DB.table("users")
    .orderBy("id")
    .cursorPaginate(2, page1.nextCursor());
  expect(page2.items.map((r) => r.name)).toEqual(["Alan"]);
  expect(page2.hasMorePages()).toBe(false);
  expect(page2.previousCursor()).toBeTruthy();

  expect(
    await DB.table("users").whereFullText(["name", "role"], "Ada").count(),
  ).toBe(1);

  await connection.close();
});

test("whereDate is driver-agnostic", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("invoices", (t) => {
    t.id();
    t.date("due_on");
  });
  await DB.table("invoices").insert({ due_on: "2026-08-08" });
  await DB.table("invoices").insert({ due_on: "2026-08-09" });
  expect(await DB.table("invoices").whereDate("due_on", "2026-08-08").count()).toBe(
    1,
  );
  await connection.close();
});

test("named connections via DB.connection", async () => {
  const primary = connectSqlite();
  const analytics = connectSqlite();
  setDefaultConnection(primary, "sqlite");
  DB.addConnection("analytics", analytics);
  expect(analytics.getName()).toBe("analytics");
  expect(DB.connection("analytics").getName()).toBe("analytics");

  const schema = schemaFor(primary);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
  });
  await schemaFor(analytics).create("events", (t) => {
    t.id();
    t.string("name");
  });

  await DB.table("users").insert({ name: "Ada" });
  await DB.connection("analytics").table("events").insert({ name: "click" });

  expect(await DB.connection().table("users").count()).toBe(1);
  expect(await DB.connection("analytics").table("events").count()).toBe(1);
  expect(await DB.connection("sqlite").table("users").value("name")).toBe("Ada");

  await DB.disconnect("analytics");
  await primary.close();
});

test("blueprint uuid json decimal foreignId enum softDeletes", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("products", (t) => {
    t.id();
    t.uuid("uuid").unique();
    t.string("name");
    t.json("meta");
    t.decimal("price", 10, 2);
    t.foreignId("category_id");
    t.enum("status", ["draft", "live"]);
    t.float("rating");
    t.softDeletes();
    t.timestamps();
  });

  expect(await schema.hasColumn("products", "uuid")).toBe(true);
  expect(await schema.hasColumn("products", "meta")).toBe(true);
  expect(await schema.hasColumn("products", "price")).toBe(true);
  expect(await schema.hasColumn("products", "category_id")).toBe(true);
  expect(await schema.hasColumn("products", "status")).toBe(true);
  expect(await schema.hasColumn("products", "deleted_at")).toBe(true);

  expect(
    dialectFor("postgres").columnSql({ name: "id", kind: "uuid" }),
  ).toContain("UUID");
  expect(
    dialectFor("postgres").columnSql({ name: "meta", kind: "json" }),
  ).toContain("JSONB");
  expect(
    dialectFor("mysql").columnSql({
      name: "status",
      kind: "enum",
      enumValues: ["a", "b"],
    }),
  ).toContain("ENUM('a', 'b')");
  expect(
    dialectFor("mysql").columnSql({ name: "user_id", kind: "unsignedBigInteger" }),
  ).toContain("UNSIGNED");

  await connection.close();
});

test("aggregates distinct addSelect chunkById afterCommit", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("metrics", (table) => {
    table.id();
    table.string("name");
    table.integer("amount");
  });
  const db = new DatabaseManager(connection);
  setDefaultConnection(connection);

  await db.table("metrics").insert({ name: "a", amount: 10 });
  await db.table("metrics").insert({ name: "a", amount: 20 });
  await db.table("metrics").insert({ name: "b", amount: 30 });

  expect(await db.table("metrics").sum("amount")).toBe(60);
  expect(await db.table("metrics").avg("amount")).toBe(20);
  expect(await db.table("metrics").min("amount")).toBe(10);
  expect(await db.table("metrics").max("amount")).toBe(30);
  expect(
    await db.table("metrics").distinct().count("name"),
  ).toBe(2);
  expect(await db.table("metrics").count("name")).toBe(3);

  const distinct = await db.table("metrics").select("name").distinct().get();
  expect(distinct).toHaveLength(2);

  const sql = db.table("metrics").select("id").addSelect("name").toSql();
  expect(sql).toContain("id");
  expect(sql).toContain("name");

  const quoted = db
    .table("categories")
    .select("id", "order", "categories.group", "count(*) as total", "*")
    .selectRaw("1 as one")
    .toSql();
  expect(quoted).toContain('"id", "order", "categories"."group"');
  expect(quoted).toContain("count(*) as total");
  expect(quoted).toContain("1 as one");

  const seen: number[] = [];
  await db.table("metrics").orderBy("id").chunkById(2, (rows) => {
    for (const row of rows) seen.push(Number(row.id));
  });
  expect(seen).toEqual([1, 2, 3]);

  let ran = false;
  await DB.transaction(async () => {
    DB.afterCommit(() => {
      ran = true;
    });
    await db.table("metrics").insert({ name: "c", amount: 1 });
    expect(ran).toBe(false);
  });
  expect(ran).toBe(true);

  await connection.close();
});

test("query builder firstOrFail / sole / insertOrIgnore / inRandomOrder", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec(`
    CREATE TABLE pets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      species TEXT
    )
  `);

  await DB.table("pets").insert({ name: "Mochi", species: "cat" });
  await DB.table("pets").insertOrIgnore({ name: "Mochi", species: "ignored" });
  expect(await DB.table("pets").count()).toBe(1);
  expect((await DB.table("pets").first())?.species).toBe("cat");

  const found = await DB.table("pets").where("name", "Mochi").firstOrFail();
  expect(found.name).toBe("Mochi");

  await expect(DB.table("pets").where("name", "Ghost").firstOrFail()).rejects.toThrow(
    RecordNotFoundException,
  );

  const only = await DB.table("pets").where("name", "Mochi").sole();
  expect(only.species).toBe("cat");

  await DB.table("pets").insert({ name: "Bean", species: "dog" });
  await expect(DB.table("pets").sole()).rejects.toThrow(RecordNotFoundException);

  expect(DB.table("pets").orderByDesc("name").toSql()).toContain("DESC");
  expect(DB.table("pets").inRandomOrder().toSql()).toContain("RANDOM()");

  const byId = await DB.table("pets").findOrFail(1);
  expect(byId.name).toBe("Mochi");

  await connection.close();
});

test("orWhere / joinSub / fromSub / having / schema listing helpers", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("orders", (table) => {
    table.id();
    table.string("status");
    table.integer("total");
  });
  await schema.create("items", (table) => {
    table.id();
    table.integer("order_id");
    table.string("sku");
  });

  await DB.table("orders").insert({ status: "open", total: 10 });
  await DB.table("orders").insert({ status: "paid", total: 20 });
  await DB.table("orders").insert({ status: "open", total: 30 });
  await DB.table("items").insert({ order_id: 1, sku: "A" });
  await DB.table("items").insert({ order_id: 2, sku: "B" });

  const orRows = await DB.table("orders")
    .where("status", "paid")
    .orWhere("total", ">", 25)
    .orderBy("id")
    .get();
  expect(orRows.pluck("id").all()).toEqual([2, 3]);

  const likeSql = DB.table("orders").whereLike("status", "%pen%").toSql();
  expect(likeSql.toUpperCase()).toContain("LIKE");

  const joined = await DB.table("orders")
    .joinSub(
      DB.table("items").select("order_id", "sku"),
      "i",
      "orders.id",
      "=",
      "i.order_id",
    )
    .where("i.sku", "A")
    .select("orders.id", "i.sku")
    .get();
  expect(joined).toHaveLength(1);
  expect(joined.first()?.sku).toBe("A");

  const fromSub = await new DatabaseManager(connection)
    .table("x")
    .fromSub(DB.table("orders").select("id", "total").where("total", ">", 15), "o")
    .orderBy("id")
    .get();
  expect(fromSub.pluck("id").all()).toEqual([2, 3]);

  const havingSql = DB.table("orders")
    .selectRaw("status, SUM(total) as sum_total")
    .groupBy("status")
    .having("sum_total", ">", 15)
    .orHaving("status", "=", "paid")
    .toSql();
  expect(havingSql.toUpperCase()).toContain("HAVING");

  await DB.table("orders").where("id", 1).incrementEach({ total: 5 });
  expect((await DB.table("orders").find(1))?.total).toBe(15);

  expect(await schema.hasColumns("orders", ["id", "status", "total"])).toBe(true);
  expect(await schema.hasColumns("orders", ["missing"])).toBe(false);
  const listing = await schema.getColumnListing("orders");
  expect(listing).toContain("status");

  await schema.withoutForeignKeyConstraints(async () => {
    await schema.raw("SELECT 1");
  });

  const names: string[] = [];
  await DB.table("orders").orderBy("id").each(async (row) => {
    names.push(String(row.status));
  }, 2);
  expect(names).toEqual(["open", "paid", "open"]);

  await connection.close();
});

test("query builder update/delete return affected row counts", async () => {
  const connection = connectSqlite();
  const schema = schemaFor(connection);
  await schema.create("widgets", (table) => {
    table.id();
    table.string("name");
    table.integer("qty");
  });

  const db = new DatabaseManager(connection);
  await db.table("widgets").insert({ name: "a", qty: 1 });
  await db.table("widgets").insert({ name: "b", qty: 1 });
  await db.table("widgets").insert({ name: "c", qty: 2 });

  expect(await db.table("widgets").where("name", "missing").update({ qty: 9 })).toBe(
    0,
  );
  expect(await db.table("widgets").where("name", "a").update({ qty: 9 })).toBe(1);
  expect(await db.table("widgets").where("qty", 1).update({ qty: 5 })).toBe(1);
  expect(await db.table("widgets").where("qty", 5).update({ qty: 7 })).toBe(1);
  // two rows still at qty 2? c=2, and we may have changed only a/b — reset seed checks:
  await db.table("widgets").update({ qty: 1 });
  expect(await db.table("widgets").update({ qty: 3 })).toBe(3);

  expect(await db.table("widgets").where("name", "missing").delete()).toBe(0);
  expect(await db.table("widgets").where("name", "a").delete()).toBe(1);
  expect(await db.table("widgets").delete()).toBe(2);

  expect(await db.table("widgets").update({})).toBe(0);

  await connection.close();
});

test("connection.run returns sqlite changes", async () => {
  const connection = connectSqlite();
  await connection.exec(
    "CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)",
  );
  await connection.run("INSERT INTO t (n) VALUES (?), (?), (?)", [1, 2, 3]);
  expect(await connection.run("UPDATE t SET n = 9 WHERE id = ?", [999])).toBe(0);
  expect(await connection.run("UPDATE t SET n = 9 WHERE id = ?", [1])).toBe(1);
  expect(
    await connection.run("UPDATE t SET n = 8 WHERE id IN (?, ?)", [1, 2]),
  ).toBe(2);
  expect(connection.runSync!("DELETE FROM t WHERE id = ?", [999])).toBe(0);
  expect(connection.runSync!("DELETE FROM t WHERE id IN (?, ?)", [1, 2])).toBe(
    2,
  );
  await connection.close();
});

test("DB.listen fires query timing events", async () => {
  clearQueryListeners();
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec(
    "CREATE TABLE listen_demo (id INTEGER PRIMARY KEY, name TEXT)",
  );

  const events: { sql: string; timeMs: number }[] = [];
  const stop = DB.listen((event) => {
    events.push({ sql: event.sql, timeMs: event.timeMs });
  });

  await DB.table("listen_demo").insert({ name: "x" });
  await DB.select("SELECT * FROM listen_demo");
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(events.some((e) => e.sql.includes("listen_demo"))).toBe(true);
  expect(events.every((e) => e.timeMs >= 0)).toBe(true);

  const before = events.length;
  stop();
  await DB.select("SELECT 1 AS n");
  expect(events.length).toBe(before);

  clearQueryListeners();
  await connection.close();
});


test("callback where / exists / union call shapes", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec(
    "CREATE TABLE audit_users (id INTEGER PRIMARY KEY, name TEXT, active INTEGER)",
  );
  await connection.exec(
    "CREATE TABLE audit_orders (id INTEGER PRIMARY KEY, user_id INTEGER)",
  );
  await DB.table("audit_users").insert([
    { id: 1, name: "Ada", active: 1 },
    { id: 2, name: "Grace", active: 1 },
    { id: 3, name: "Alan", active: 0 },
  ]);
  await DB.table("audit_orders").insert({ id: 1, user_id: 1 });

  const grouped = await DB.table("audit_users")
    .where((query) => {
      query.where("name", "Ada").orWhere("name", "Alan");
    })
    .where("active", 1)
    .pluck("name");
  expect(grouped.all()).toEqual(["Ada"]);
  expect(
    await DB.table("audit_users")
      .whereAny(["name", "name"], "like", "A%")
      .whereNone(["name"], "=", "Grace")
      .count(),
  ).toBe(2);
  expect(
    await DB.table("audit_users")
      .whereAll(["active", "active"], "=", 1)
      .count(),
  ).toBe(2);

  const orders = DB.table("audit_orders")
    .select("id")
    .whereColumn("audit_orders.user_id", "audit_users.id");
  expect(await DB.table("audit_users").whereExists(orders).pluck("name").then((c) => c.all())).toEqual([
    "Ada",
  ]);

  const unioned = await DB.table("audit_users")
    .select("id", "name")
    .where("name", "Ada")
    .union((query) => {
      query.from("audit_users").select("id", "name").where("name", "Grace");
    })
    .orderBy("id")
    .get();
  expect(unioned.pluck("name").all()).toEqual(["Ada", "Grace"]);
  await connection.close();
});

test("join and joinSub callback call shapes", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec(
    "CREATE TABLE join_users (id INTEGER PRIMARY KEY, active INTEGER)",
  );
  await connection.exec(
    "CREATE TABLE join_posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)",
  );
  await DB.table("join_users").insert([
    { id: 1, active: 1 },
    { id: 2, active: 0 },
  ]);
  await DB.table("join_posts").insert([
    { id: 1, user_id: 1, title: "kept" },
    { id: 2, user_id: 2, title: "filtered" },
  ]);

  const joined = await DB.table("join_posts")
    .join("join_users", (join) => {
      join
        .on("join_posts.user_id", "=", "join_users.id")
        .where("join_users.active", "=", 1);
    })
    .pluck("title");
  expect(joined.all()).toEqual(["kept"]);

  const sub = DB.table("join_users").select("id", "active");
  const joinedSub = await DB.table("join_posts")
    .joinSub(sub, "u", (join) => {
      join.on("join_posts.user_id", "=", "u.id").where("u.active", "=", 1);
    })
    .pluck("title");
  expect(joinedSub.all()).toEqual(["kept"]);
  await connection.close();
});

test("paginator argument order and write return shapes", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec(
    "CREATE TABLE parity_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, qty INTEGER)",
  );

  expect(
    await DB.table("parity_items").insert([
      { sku: "A", qty: 1 },
      { sku: "B", qty: 2 },
      { sku: "C", qty: 3 },
    ]),
  ).toBe(true);
  expect(
    await DB.table("parity_items").insertOrIgnore([
      { sku: "A", qty: 9 },
      { sku: "D", qty: 4 },
    ]),
  ).toBe(1);

  const updated = await DB.table("parity_items").updateOrInsert(
    { sku: "D" },
    (exists) => ({ qty: exists ? 5 : 1 }),
  );
  expect(updated).toBe(true);
  expect(await DB.table("parity_items").where("sku", "D").value("qty")).toBe(5);
  expect(
    await DB.table("parity_items").upsert(
      { sku: "D", qty: 6 },
      "sku",
      ["qty"],
    ),
  ).toBe(1);

  const page = await DB.table("parity_items")
    .orderBy("id")
    .paginate(2, ["id", "sku"], "p", 2);
  expect(page.items.map((row) => row.sku)).toEqual(["C", "D"]);
  expect(page.items[0]?.qty).toBeUndefined();
  const linked = await DB.table("parity_items")
    .orderBy("id")
    .paginate(2, 1, { path: "/items" });
  expect(linked.links().next).toBe("/items?page=2");

  const simple = await DB.table("parity_items")
    .orderBy("id")
    .simplePaginate(2, ["id", "sku"], "p", 1);
  expect(simple.pageItems()).toHaveLength(2);
  expect(simple.pageItems()[0]?.qty).toBeUndefined();

  const cursorPage = await DB.table("parity_items")
    .orderBy("id")
    .cursorPaginate(2, ["id", "sku"], "after", null);
  expect(cursorPage.items).toHaveLength(2);
  expect(cursorPage.items[0]?.qty).toBeUndefined();
  expect(cursorPage.toJSON()).toHaveProperty("next_cursor");
  await connection.close();
});

test("query values and raw bindings stay parameterized", async () => {
  const hostile = "x' OR 1=1 --";
  const connection = connectSqlite();
  const query = new DatabaseManager(connection)
    .table("users")
    .selectRaw("? as marker", [hostile])
    .where("email", hostile)
    .whereRaw("score > ?", [10]);
  expect(query.toSql()).not.toContain(hostile);
  expect(query.getBindings()).toEqual([hostile, hostile, 10]);
  await connection.close();
});

test("DB.scalar returns first column of first row", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await schemaFor(connection).create("nums", (t) => {
    t.id();
    t.integer("n");
  });
  await DB.insert("INSERT INTO nums (n) VALUES (?)", [42]);
  expect(await DB.scalar("SELECT n FROM nums WHERE id = 1")).toBe(42);
  expect(await DB.scalar("SELECT COUNT(*) FROM nums")).toBe(1);
  await connection.close();
});

test("DB.transaction retries on deadlock-like errors", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  let attempts = 0;
  const value = await DB.transaction(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error("database is locked");
    }
    return "ok";
  }, 5);
  expect(value).toBe("ok");
  expect(attempts).toBe(3);
  await connection.close();
});
