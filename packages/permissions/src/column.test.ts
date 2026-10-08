import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { connectMysql, connectPostgres, connectSqlite, schemaFor, type Connection } from "@bunyad/database";
import { HasPermissions, type PermissionMethods } from "./has-permissions.ts";
import { Permissions, setPermissions } from "./manager.ts";
import { addAccessColumn, createPermissionTables, dropPermissionTables } from "./migration.ts";
import { ScopeTree } from "./scope.ts";
import type { PermissionsDb } from "./types.ts";

type Driver = { name: string; connection: Connection };
const all: Driver[] = [{ name: "sqlite", connection: connectSqlite() }];
if (Bun.env.BUNYAD_TEST_POSTGRES_URL && /^postgres/i.test(Bun.env.BUNYAD_TEST_POSTGRES_URL)) {
  all.push({ name: "postgres", connection: connectPostgres({ url: Bun.env.BUNYAD_TEST_POSTGRES_URL, max: 2 }) });
}
if (Bun.env.BUNYAD_TEST_MYSQL_URL && /^mysql:/i.test(Bun.env.BUNYAD_TEST_MYSQL_URL)) {
  all.push({ name: "mysql", connection: connectMysql({ url: Bun.env.BUNYAD_TEST_MYSQL_URL, tls: { rejectUnauthorized: false } }) });
}
afterAll(async () => {
  for (const { connection } of all) {
    await schemaFor(connection).dropIfExists("perm_test_users");
    await dropPermissionTables(schemaFor(connection));
    await connection.close();
  }
});

const TABLE = "perm_test_users";
const COLUMN = "permission_access";

describe.each(all.map((d) => [d.name, d] as const))("column grant source (%s)", (_name, driver) => {
  const c = driver.connection;
  let reads = 0;
  const db: PermissionsDb = {
    run: (sql, params) => c.run(sql, params),
    get: (sql, params) => (reads++, c.get(sql, params)),
    all: (sql, params) => (reads++, c.all(sql, params)),
    transaction: (fn) => c.transaction(fn),
  };
  const make = (extra: Partial<ConstructorParameters<typeof Permissions>[0]> = {}) =>
    new Permissions({
      db,
      scopes: new ScopeTree(),
      columns: { user: { table: TABLE, column: COLUMN } },
      consistency: "eventual",
      ttlMs: 60_000,
      strict: true,
      now: () => 1_700_000_000_000,
      ...extra,
    });
  const row = async (id: number) => (await c.get<Record<string, unknown>>(`SELECT id, ${COLUMN} FROM ${TABLE} WHERE id = ?`, [id]))!;
  /** A user as the app would load it: the row, with its access column. */
  const loaded = async (id: number) => {
    const r = await row(id);
    return { type: "user", id, access: (r[COLUMN] as string | null) ?? null };
  };

  let perms: Permissions;
  beforeEach(async () => {
    const schema = schemaFor(c);
    await schema.dropIfExists(TABLE);
    await dropPermissionTables(schema);
    await createPermissionTables(schema);
    await schema.create(TABLE, (t) => {
      t.id();
      t.string("name");
    });
    await addAccessColumn(schema, TABLE, COLUMN);
    for (const id of [1, 2, 3]) await c.run(`INSERT INTO ${TABLE} (id, name) VALUES (?, ?)`, [id, `u${id}`]);
    perms = make();
    await perms.sync(["posts.view", "posts.update", "posts.delete"]);
    await perms.createRole("editor", "tenant:7");
    await perms.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.view", "posts.update"]);
  });

  test("grant changes write the column; a loaded user answers without a grants query", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    await perms.grantRole({ type: "user", id: 2 }, "editor", "tenant:7");
    expect(String((await row(1))[COLUMN])).toContain('"g":[["tenant:7",1,');

    const fresh = make();
    const first = await loaded(1);
    reads = 0;
    expect(await fresh.can(first, "posts.update", "tenant:7")).toBe(true);
    // Registry rows + the roles of the scope. No grants statement.
    expect(reads).toBe(2);

    // A second user in the same tenant costs nothing: roles are shared, grants come from the row.
    const second = await loaded(2);
    reads = 0;
    expect(await fresh.can(second, "posts.update", "tenant:7")).toBe(true);
    expect(await fresh.can(second, "posts.delete", "tenant:7")).toBe(false);
    expect(reads).toBe(0);
  });

  test("a NULL column is not materialized: the grants table answers", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    await c.run(`UPDATE ${TABLE} SET ${COLUMN} = NULL WHERE id = 1`);
    const fresh = make();
    expect(await fresh.can(await loaded(1), "posts.update", "tenant:7")).toBe(true);
    expect(await fresh.can(await loaded(3), "posts.update", "tenant:7")).toBe(false);
  });

  test("a revoke is seen as soon as the row is loaded again, even inside the cache window", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    const process = make();
    expect(await process.can(await loaded(1), "posts.update", "tenant:7")).toBe(true);
    await perms.revokeRole({ type: "user", id: 1 }, "editor", "tenant:7");
    expect(await process.can(await loaded(1), "posts.update", "tenant:7")).toBe(false);
    await perms.grantPermission({ type: "user", id: 1 }, "posts.delete", "tenant:7");
    expect(await process.can(await loaded(1), "posts.delete", "tenant:7")).toBe(true);
  });

  test("expired grants in the column are ignored", async () => {
    await perms.grantPermission({ type: "user", id: 1 }, "posts.view", "tenant:7", { expiresAt: 1_700_000_000 - 5 });
    expect(await make().can(await loaded(1), "posts.view", "tenant:7")).toBe(false);
  });

  test("too many grants overflow to the grants table and stay correct", async () => {
    const small = make({ maxColumnGrants: 2 });
    for (const permission of ["posts.view", "posts.update", "posts.delete"]) {
      await small.grantPermission({ type: "user", id: 1 }, permission, "tenant:7");
    }
    expect(String((await row(1))[COLUMN])).toBe('{"v":1,"o":1}');
    const check = make({ maxColumnGrants: 2 });
    expect(await check.can(await loaded(1), "posts.delete", "tenant:7")).toBe(true);
    await small.revokePermission({ type: "user", id: 1 }, "posts.delete", "tenant:7");
    expect(await make({ maxColumnGrants: 2 }).can(await loaded(1), "posts.delete", "tenant:7")).toBe(false);
  });

  test("deleting a role rewrites its holders\' columns", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    await perms.deleteRole({ name: "editor", scope: "tenant:7" });
    expect(String((await row(1))[COLUMN])).toBe('{"v":1,"g":[]}');
  });

  test("rebuildAccess repairs the column and fills empty ones", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    await c.run(`UPDATE ${TABLE} SET ${COLUMN} = 'garbage' WHERE id = 1`);
    expect(await perms.rebuildAccess("user")).toBe(1);
    expect(String((await row(1))[COLUMN])).toContain("tenant:7");
    expect(String((await row(3))[COLUMN])).toBe('{"v":1,"g":[]}');
  });

  test("a garbage column falls back to the grants table", async () => {
    await perms.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");
    await c.run(`UPDATE ${TABLE} SET ${COLUMN} = 'garbage' WHERE id = 1`);
    expect(await make().can(await loaded(1), "posts.update", "tenant:7")).toBe(true);
  });

  test("HasPermissions reads the column and keeps the model in step with its own changes", async () => {
    @HasPermissions({ type: "user" })
    class User {
      permission_access: string | null = null;
      constructor(public id: number) {}
    }
    interface User extends PermissionMethods {}
    setPermissions(perms);
    const user = new User(1);
    user.permission_access = (await loaded(1)).access;
    await user.grantRole("editor", "tenant:7");
    expect(user.permission_access).toContain("tenant:7");
    expect(await user.can("posts.update", "tenant:7")).toBe(true);
    await user.revokeRole("editor", "tenant:7");
    expect(await user.can("posts.update", "tenant:7")).toBe(false);
    setPermissions(undefined);
  });
});
