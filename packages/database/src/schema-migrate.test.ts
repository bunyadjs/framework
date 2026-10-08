import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectPostgres,
  connectSqlite,
  dialectFor,
  migrate,
  migrateCompiled,
  rollback,
  schemaFor,
  status,
  type Connection,
  type MigratorOptions,
} from "../src/index.ts";

const CUSTOM_MIGRATOR: MigratorOptions = {
  table: "_schema_migrations",
  migrationColumn: "name",
  batchColumn: false,
};

const schemaUrl = new URL("../src/schema.ts", import.meta.url).href;

async function withSqlite(
  fn: (connection: Connection) => Promise<void>,
): Promise<void> {
  const connection = connectSqlite();
  try {
    await fn(connection);
  } finally {
    await connection.close();
  }
}

async function withPostgres(
  fn: (connection: Connection) => Promise<void>,
): Promise<void> {
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
  } catch {
    await connection.close();
    return;
  }
  try {
    await fn(connection);
  } finally {
    await connection.close();
  }
}

test("decimal precision and scale render per dialect", () => {
  const col = {
    name: "credit_limit",
    kind: "decimal" as const,
    precision: 15,
    scale: 2,
  };
  expect(dialectFor("postgres").columnSql(col)).toContain("DECIMAL(15, 2)");
  expect(dialectFor("mysql").columnSql(col)).toContain("DECIMAL(15, 2)");
  expect(dialectFor("sqlite").columnSql(col)).toContain("TEXT");
});

test("smallInteger is SMALLINT on postgres and INTEGER on sqlite", () => {
  const col = { name: "attempts", kind: "smallInteger" as const };
  expect(dialectFor("postgres").columnSql(col)).toContain("SMALLINT");
  expect(dialectFor("sqlite").columnSql(col)).toContain("INTEGER");
});

test("increments is SERIAL on postgres and INTEGER PK on sqlite", () => {
  const col = {
    name: "id",
    kind: "integer" as const,
    primary: true,
    autoIncrement: true,
  };
  expect(dialectFor("postgres").columnSql(col)).toContain("SERIAL");
  expect(dialectFor("sqlite").columnSql(col)).toContain("AUTOINCREMENT");
});

test("useCurrent emits an unquoted current-timestamp default", () => {
  const col = {
    name: "created_at",
    kind: "timestamp" as const,
    useCurrent: true,
    nullable: false,
  };
  expect(dialectFor("sqlite").columnSql(col)).toContain("CURRENT_TIMESTAMP");
  expect(dialectFor("sqlite").columnSql(col)).not.toContain("'CURRENT_TIMESTAMP'");
  expect(dialectFor("postgres").columnSql(col)).toContain("CURRENT_TIMESTAMP");
});

test("postgres timestamp is without time zone; timestampTz is TIMESTAMPTZ", () => {
  expect(
    dialectFor("postgres").columnSql({ name: "created_at", kind: "timestamp" }),
  ).toContain("TIMESTAMP");
  expect(
    dialectFor("postgres").columnSql({ name: "created_at", kind: "timestamp" }),
  ).not.toContain("TIMESTAMPTZ");
  expect(
    dialectFor("postgres").columnSql({ name: "created_at", kind: "timestampTz" }),
  ).toContain("TIMESTAMPTZ");
});

test("blueprint indexes unique foreign keys and partial unique", async () => {
  await withSqlite(async (connection) => {
    const schema = schemaFor(connection);
    expect(schema.getConnection().getDriverName()).toBe("sqlite");
    await schema.create("users", (table) => {
      table.id();
      table.string("email");
      table.string("phone").nullable();
      table.unique("email", "idx_users_email");
      table.unique("phone", "idx_users_phone").where("phone IS NOT NULL");
    });
    await schema.create("posts", (table) => {
      table.id();
      table.foreignId("user_id").constrained("users").cascadeOnDelete();
      table.string("title");
      table.index("title", "idx_posts_title");
      table.timestamps();
    });

    const indexes = await connection.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('users', 'posts') ORDER BY name`,
    );
    const names = indexes.map((r) => r.name);
    expect(names).toContain("idx_users_email");
    expect(names).toContain("idx_users_phone");
    expect(names).toContain("idx_posts_title");

    const postsSql = (
      await connection.get<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'`,
      )
    )?.sql;
    expect(postsSql).toContain("REFERENCES");
    expect(postsSql?.toUpperCase()).toContain("ON DELETE CASCADE");

    await connection.run("INSERT INTO users (email) VALUES (?)", ["a@b.c"]);
    await expect(
      connection.run("INSERT INTO posts (user_id, title) VALUES (?, ?)", [
        99,
        "missing user",
      ]),
    ).rejects.toThrow();
  });
});

test("blueprint composite primary key", async () => {
  await withSqlite(async (connection) => {
    const schema = schemaFor(connection);
    await schema.create("role_has_permissions", (table) => {
      table.integer("permission_id");
      table.integer("role_id");
      table.primary(["permission_id", "role_id"]);
    });
    const sql = (
      await connection.get<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'role_has_permissions'`,
      )
    )?.sql;
    expect(sql).toContain('PRIMARY KEY ("permission_id", "role_id")');
  });
});

test("nullable() allows NULL; nullable(false) is NOT NULL", async () => {
  await withSqlite(async (connection) => {
    const schema = schemaFor(connection);
    await schema.create("flags", (table) => {
      table.id();
      table.string("optional").nullable();
      table.string("explicit_null").nullable(true);
      table.string("required").nullable(false);
      table.string("implied");
    });
    const sql = (
      await connection.get<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'flags'`,
      )
    )?.sql;
    expect(sql).toContain('"optional" TEXT');
    expect(sql).not.toMatch(/"optional" TEXT NOT NULL/);
    expect(sql).not.toMatch(/"explicit_null" TEXT NOT NULL/);
    expect(sql).toContain('"required" TEXT NOT NULL');
    expect(sql).toContain('"implied" TEXT NOT NULL');
  });
});

test("alter add column index and sqlite rename", async () => {
  await withSqlite(async (connection) => {
    const schema = schemaFor(connection);
    await schema.create("notes", (table) => {
      table.id();
      table.string("title");
    });
    await schema.table("notes", (table) => {
      table.text("body").nullable();
      table.boolean("pinned").nullable(false).default(false);
      table.index("body", "idx_notes_body");
    });
    expect(await schema.hasColumn("notes", "body")).toBe(true);
    expect(await schema.hasColumn("notes", "pinned")).toBe(true);

    const indexes = await connection.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notes'`,
    );
    expect(indexes.map((r) => r.name)).toContain("idx_notes_body");

    await schema.table("notes", (table) => {
      table.renameColumn("body", "content");
    });
    expect(await schema.hasColumn("notes", "content")).toBe(true);
    expect(await schema.hasColumn("notes", "body")).toBe(false);
  });
});

test("schema.raw creates a partial unique index", async () => {
  await withSqlite(async (connection) => {
    const schema = schemaFor(connection);
    await schema.create("contacts", (table) => {
      table.id();
      table.string("tenant_id");
      table.string("email").nullable();
    });
    await schema.raw(
      `CREATE UNIQUE INDEX idx_contacts_tenant_email ON contacts (tenant_id, email) WHERE email IS NOT NULL`,
    );
    await connection.run(
      "INSERT INTO contacts (tenant_id, email) VALUES (?, ?)",
      ["t1", "a@b.c"],
    );
    await connection.run(
      "INSERT INTO contacts (tenant_id, email) VALUES (?, ?)",
      ["t1", null],
    );
    await connection.run(
      "INSERT INTO contacts (tenant_id, email) VALUES (?, ?)",
      ["t1", null],
    );
    await expect(
      connection.run("INSERT INTO contacts (tenant_id, email) VALUES (?, ?)", [
        "t1",
        "a@b.c",
      ]),
    ).rejects.toThrow();
  });
});

test("custom migrations table matches a custom _schema_migrations shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-custom-mig-"));
  await Bun.write(
    join(dir, "0001_notes.ts"),
    `import type { Schema } from ${JSON.stringify(schemaUrl)};
export async function up(schema: Schema) {
  await schema.create("notes", (t) => { t.id(); t.string("title"); });
}
export async function down(schema: Schema) {
  await schema.dropIfExists("notes");
}
`,
  );

  await withSqlite(async (connection) => {
    expect(await migrate(connection, dir, CUSTOM_MIGRATOR)).toEqual([
      "0001_notes.ts",
    ]);
    expect(await schemaFor(connection).hasTable("notes")).toBe(true);
    expect(await schemaFor(connection).hasTable("migrations")).toBe(false);
    expect(await schemaFor(connection).hasTable("_schema_migrations")).toBe(
      true,
    );

    const rows = await connection.all<{ name: string }>(
      `SELECT name FROM "_schema_migrations"`,
    );
    expect(rows.map((r) => r.name)).toEqual(["0001_notes.ts"]);

    const statusRows = await status(connection, dir, CUSTOM_MIGRATOR);
    expect(statusRows[0]?.migration).toBe("0001_notes.ts");
    expect(statusRows[0]?.batch).not.toBeNull();

    expect(await migrate(connection, dir, CUSTOM_MIGRATOR)).toEqual([]);

    expect(await rollback(connection, dir, 1, CUSTOM_MIGRATOR)).toEqual([
      "0001_notes.ts",
    ]);
    expect(await schemaFor(connection).hasTable("notes")).toBe(false);
  });
});

test("migrateCompiled records into a custom table", async () => {
  await withSqlite(async (connection) => {
    const applied = await migrateCompiled(
      connection,
      [
        {
          migration: "0002_tags.ts",
          async up(schema) {
            await schema.create("tags", (t) => {
              t.id();
              t.string("name");
            });
          },
          async down(schema) {
            await schema.dropIfExists("tags");
          },
        },
      ],
      CUSTOM_MIGRATOR,
    );
    expect(applied).toEqual(["0002_tags.ts"]);
    const rows = await connection.all<{ name: string }>(
      `SELECT name FROM "_schema_migrations"`,
    );
    expect(rows[0]?.name).toBe("0002_tags.ts");
  });
});

test("postgres schema indexes foreign keys alter and custom migrator", async () => {
  await withPostgres(async (connection) => {
    const schema = schemaFor(connection);
    expect(schema.getConnection().getDriverName()).toBe("pgsql");
    await schema.dropIfExists("posts");
    await schema.dropIfExists("users");
    await schema.dropIfExists("_schema_migrations");
    await schema.dropIfExists("pg_notes");

    await schema.create("users", (table) => {
      table.id();
      table.string("email");
      table.unique("email", "idx_users_email");
    });
    await schema.create("posts", (table) => {
      table.id();
      table.foreignId("user_id").constrained("users").cascadeOnDelete();
      table.decimal("price", 15, 2).default(0);
      table.index("user_id", "idx_posts_user_id");
    });
    await schema.table("posts", (table) => {
      table.string("title").nullable();
    });
    expect(await schema.hasColumn("posts", "title")).toBe(true);
    expect(await schema.hasColumn("posts", "price")).toBe(true);

    await connection.run("INSERT INTO users (email) VALUES (?)", ["pg@test"]);
    await expect(
      connection.run("INSERT INTO posts (user_id, price) VALUES (?, ?)", [
        99,
        1,
      ]),
    ).rejects.toThrow();

    const applied = await migrateCompiled(
      connection,
      [
        {
          migration: "0001_pg_notes.ts",
          async up(s) {
            await s.create("pg_notes", (t) => {
              t.id();
              t.string("title");
            });
          },
        },
      ],
      CUSTOM_MIGRATOR,
    );
    expect(applied).toEqual(["0001_pg_notes.ts"]);
    const rows = await connection.all<{ name: string }>(
      `SELECT name FROM _schema_migrations`,
    );
    expect(rows[0]?.name).toBe("0001_pg_notes.ts");

    await schema.dropIfExists("posts");
    await schema.dropIfExists("users");
    await schema.dropIfExists("pg_notes");
    await schema.dropIfExists("_schema_migrations");
  });
});
