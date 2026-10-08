import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { connectMysql, connectPostgres, connectSqlite, schemaFor, type Connection } from "@bunyad/database";
import { getProviderCommandHandlers } from "@bunyad/core";
import { Model } from "@bunyad/orm";
import { registerPermissionCommands, unknownPermissionsInRoutes } from "./commands.ts";
import { HasPermissions, type PermissionStatics } from "./has-permissions.ts";
import { Permissions, setPermissions, withClaims } from "./manager.ts";
import { addAccessColumn, createPermissionTables, dropPermissionTables } from "./migration.ts";
import { ScopeTree } from "./scope.ts";
import { MemoryVersionStore } from "./versions.ts";
import type { PermissionsDb, VersionStore } from "./types.ts";

type Driver = { name: string; connection: Connection };
const all: Driver[] = [{ name: "sqlite", connection: connectSqlite() }];
if (Bun.env.BUNYAD_TEST_POSTGRES_URL && /^postgres/i.test(Bun.env.BUNYAD_TEST_POSTGRES_URL)) {
  all.push({ name: "postgres", connection: connectPostgres({ url: Bun.env.BUNYAD_TEST_POSTGRES_URL, max: 2 }) });
}
if (Bun.env.BUNYAD_TEST_MYSQL_URL && /^mysql:/i.test(Bun.env.BUNYAD_TEST_MYSQL_URL)) {
  all.push({ name: "mysql", connection: connectMysql({ url: Bun.env.BUNYAD_TEST_MYSQL_URL, tls: { rejectUnauthorized: false } }) });
}
const TABLE = "perm_adv_users";

afterAll(async () => {
  for (const { connection } of all) {
    await schemaFor(connection).dropIfExists(TABLE);
    await dropPermissionTables(schemaFor(connection));
    await connection.close();
  }
  setPermissions(undefined);
});

describe.each(all.map((d) => [d.name, d] as const))("advanced (%s)", (_name, driver) => {
  const c = driver.connection;
  let reads = 0;
  const db = {
    driver: c.driver as string,
    run: (sql: string, params?: unknown[]) => c.run(sql, params),
    get: (sql: string, params?: unknown[]) => (reads++, c.get(sql, params)),
    all: (sql: string, params?: unknown[]) => (reads++, c.all(sql, params)),
    transaction: <T>(fn: () => T | Promise<T>) => c.transaction(fn),
  };
  const pdb = db as unknown as PermissionsDb;
  const scopes = () => new ScopeTree().parent("team", (id) => (id === "99" ? null : "tenant:7"));
  const make = (extra: Partial<ConstructorParameters<typeof Permissions>[0]> = {}) =>
    new Permissions({ db: pdb, scopes: scopes(), strict: true, now: () => 1_700_000_000_000, ...extra });
  let perms: Permissions;

  @HasPermissions({ type: "user" })
  class AdvUser extends Model {
    static table = TABLE;
    static fillable = ["name"];
    declare id: number;
    declare name: string;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
  interface AdvUser extends PermissionStatics {}
  const Users = AdvUser as unknown as typeof AdvUser & PermissionStatics;

  beforeEach(async () => {
    const schema = schemaFor(c);
    await schema.dropIfExists(TABLE);
    await dropPermissionTables(schema);
    await createPermissionTables(schema);
    await schema.create(TABLE, (t) => {
      t.id();
      t.string("name");
    });
    await addAccessColumn(schema, TABLE, "permission_access");
    Model.setConnection(c);
    for (let i = 1; i <= 6; i++) await c.run(`INSERT INTO ${TABLE} (id, name) VALUES (?, ?)`, [i, `u${i}`]);
    perms = make();
    setPermissions(perms);
    await perms.sync(["posts.view", "posts.update", "posts.delete"]);
    await perms.createRole("editor", "tenant:7");
    await perms.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.update"]);
    await perms.createRole("admin", "tenant:7");
    await perms.givePermissions({ name: "admin", scope: "tenant:7" }, ["posts.*"]);
  });

  const u = (id: number) => ({ type: "user", id });

  test("whereCan and whereHasRole work as query conditions, with paging and counts", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    await perms.grantRole(u(2), "admin", "tenant:7");
    await perms.grantPermission(u(3), "posts.update", "team:42");
    await perms.grantPermission(u(4), "posts.view", "tenant:7");

    const names = async (query: Promise<any>) => (await (await query).orderBy("id").get()).pluck("name").all();
    expect(await names(Users.whereCan("posts.update", "tenant:7"))).toEqual(["u1", "u2"]);
    expect(await names(Users.whereCan("posts.update", "team:42"))).toEqual(["u1", "u2", "u3"]);
    expect(await names(Users.whereCan("posts.view", "team:42"))).toEqual(["u2", "u4"]);
    expect(await names(Users.whereHasRole("editor", "tenant:7"))).toEqual(["u1"]);
    expect(await (await Users.whereCan("posts.update", "team:42")).count()).toBe(3);
    // Composes with other conditions.
    expect(await names((async () => (await Users.whereCan("posts.update", "team:42")).where("name", "u3"))())).toEqual(["u3"]);
    // Unknown role: nobody.
    expect(await names(Users.whereHasRole("nope", "tenant:7"))).toEqual([]);
  });

  test("whereCan ignores expired grants", async () => {
    await perms.grantPermission(u(1), "posts.update", "tenant:7", { expiresAt: 1_700_000_000 - 1 });
    await perms.grantPermission(u(2), "posts.update", "tenant:7", { expiresAt: 1_700_000_000 + 600 });
    const rows = await (await Users.whereCan("posts.update", "tenant:7")).orderBy("id").get();
    expect(rows.pluck("name").all()).toEqual(["u2"]);
  });

  test("grantMany is chunked, skips holders, and keeps access columns in step", async () => {
    const withColumn = make({ columns: { user: { table: TABLE, column: "permission_access" } } });
    await withColumn.grantRole(u(1), "editor", "tenant:7");
    const created = await withColumn.grantMany([1, 2, 3, 4, 5].map(u), { role: "editor" }, "tenant:7");
    expect(created).toBe(4);
    expect(await withColumn.grantMany([1, 2, 3].map(u), { role: "editor" }, "tenant:7")).toBe(0);
    expect(await withColumn.grantMany([6].map(u), { permission: "posts.view" }, "tenant:7")).toBe(1);
    const row = await c.get<{ permission_access: string }>(`SELECT permission_access FROM ${TABLE} WHERE id = 5`);
    expect(row!.permission_access).toContain("tenant:7");
    expect(await withColumn.can(u(5), "posts.update", "tenant:7")).toBe(true);
    expect(await withColumn.can(u(6), "posts.view", "tenant:7")).toBe(true);
    expect((await withColumn.whoCan("posts.update", "tenant:7")).length).toBe(5);
  });

  test("revokeAll removes everything, or one scope", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    await perms.grantPermission(u(1), "posts.view");
    await perms.revokeAll(u(1), "tenant:7");
    expect(await perms.can(u(1), "posts.update", "tenant:7")).toBe(false);
    expect(await perms.can(u(1), "posts.view", "tenant:7")).toBe(true);
    await perms.revokeAll(u(1));
    expect(await perms.can(u(1), "posts.view", "tenant:7")).toBe(false);
  });

  test("claims: valid until the subject changes, then the database decides", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    const claims = await perms.issueClaims(u(1));
    const process = make();
    reads = 0;
    expect(await process.can(withClaims(u(1), claims), "posts.update", "tenant:7")).toBe(true);
    expect(reads).toBe(2); // the permission list and the roles; no grants statement

    await perms.revokeRole(u(1), "editor", "tenant:7");
    // Same token, but the counter has moved: the old claims no longer apply.
    expect(await perms.can(withClaims(u(1), claims), "posts.update", "tenant:7")).toBe(false);
  });

  test("a failing cache or counter store falls back to the database and never allows by mistake", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    const broken: VersionStore = { get: () => Promise.reject(new Error("redis down")), bump: () => Promise.reject(new Error("redis down")) };
    const errors: string[] = [];
    const degraded = make({
      versions: broken,
      cache: { get: () => Promise.reject(new Error("down")), put: () => Promise.reject(new Error("down")) },
      onError: (_e, where) => void errors.push(where),
    });
    expect(await degraded.can(u(1), "posts.update", "tenant:7")).toBe(true);
    expect(await degraded.can(u(2), "posts.update", "tenant:7")).toBe(false);
    expect(errors).toContain("versions");
  });

  test("strict mode reads counters once per request thanks to the request memo", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    const inner = new MemoryVersionStore();
    let counterReads = 0;
    const counted: VersionStore = { get: (keys) => (counterReads++, inner.get(keys)), bump: (key) => inner.bump(key) };
    const strict = make({ versions: counted, consistency: "strict" });
    await strict.can(u(1), "posts.update", "tenant:7");
    counterReads = 0;
    await strict.runRequest(async () => {
      for (let i = 0; i < 10; i++) await strict.can(u(1), "posts.update", "tenant:7");
    });
    expect(counterReads).toBe(1);
    // A write inside the request is seen by the next check in the same request.
    await strict.runRequest(async () => {
      expect(await strict.can(u(1), "posts.delete", "tenant:7")).toBe(false);
      await strict.grantPermission(u(1), "posts.delete", "tenant:7");
      expect(await strict.can(u(1), "posts.delete", "tenant:7")).toBe(true);
    });
  });

  test("warm builds snapshots ahead of traffic; clearCache makes processes recompute", async () => {
    await perms.grantRole(u(1), "editor", "tenant:7");
    const process = make();
    await process.warm(["tenant:7"]);
    reads = 0;
    expect(await process.can(u(1), "posts.update", "tenant:7")).toBe(true);
    expect(reads).toBe(1); // only the grants: roles were warmed
    await perms.clearCache();
    expect(await process.can(u(1), "posts.update", "tenant:7")).toBe(true);
  });
});

test("route middleware naming undeclared permissions is reported", () => {
  const declared = new Set(["posts.view", "posts.update"]);
  const routes = [
    { uri: "/a", middleware: ["permission:posts.view", "auth"] },
    { uri: "/b", middleware: [{ alias: "permission.any:posts.update,posts.nope@team:{team}" }] },
    { uri: "/c", middleware: ["permission:posts.*", "role:whatever"] },
    { uri: "/d", middleware: ["permission:billing.*"] },
    { uri: "/e", middleware: [() => null] },
  ];
  expect(unknownPermissionsInRoutes(routes, declared)).toEqual([
    { uri: "/b", middleware: "permission.any:posts.update,posts.nope@team:{team}", name: "posts.nope" },
    { uri: "/d", middleware: "permission:billing.*", name: "billing.*" },
  ]);
});

test("permissions:warm and permissions:cache-clear run through the provider command registry", async () => {
  const connection = connectSqlite();
  await createPermissionTables(schemaFor(connection));
  const permissions = new Permissions({ db: connection, strict: true });
  await permissions.sync(["a.b"]);
  registerPermissionCommands({ permissions: () => permissions, declared: () => ["a.b"], warm: () => ["*"] });
  const handlers = getProviderCommandHandlers();
  for (const name of ["permissions:sync", "permissions:warm", "permissions:cache-clear", "permissions:prune", "permissions:rebuild", "permissions:check-routes", "permissions:doctor"]) {
    expect(typeof handlers[name]).toBe("function");
  }
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void logs.push(args.join(" "));
  try {
    await handlers["permissions:warm"]!([]);
    await handlers["permissions:cache-clear"]!(["--scope=tenant:1"]);
  } finally {
    console.log = original;
  }
  expect(logs).toEqual(["Warmed role snapshots for *.", "Permission cache cleared for tenant:1."]);
  await connection.close();
});
