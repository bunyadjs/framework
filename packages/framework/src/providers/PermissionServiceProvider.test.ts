import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Application } from "@bunyad/core";
import { Cache, CacheRepository, MemoryCacheStore, setCache } from "@bunyad/cache";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Gate } from "@bunyad/auth";
import { getMiddlewareAlias } from "@bunyad/http";
import { Permissions, createPermissionTables, getPermissions, setPermissions } from "@bunyad/permissions";
import { PermissionServiceProvider } from "./PermissionServiceProvider.ts";

const connection = connectSqlite();

beforeAll(async () => {
  await createPermissionTables(schemaFor(connection));
  setCache(new CacheRepository(new MemoryCacheStore(), { store: "memory" }));
});
afterAll(async () => {
  setPermissions(undefined);
  await connection.close();
});

function makeApp(config: Record<string, unknown>) {
  const app = new Application({ basePath: process.cwd(), config: { app: { port: 0 }, ...config } });
  app.instance("db", connection);
  return app;
}

test("does nothing without config/permissions", async () => {
  const app = makeApp({});
  app.register(PermissionServiceProvider);
  await app.boot();
  expect(app.bound("permissions")).toBe(false);
});

test("builds Permissions from config, wires cache counters, gate, middleware and commands", async () => {
  const app = makeApp({
    permissions: {
      declared: ["posts.view", "posts.update"],
      scopes: { team: { parent: () => "tenant:7" } },
      superAdmin: (subject: { id: string | number }) => subject.id === 99,
    },
  });
  app.register(PermissionServiceProvider);
  await app.boot();

  const permissions = app.make<Permissions>("permissions");
  expect(permissions).toBeInstanceOf(Permissions);
  expect(getPermissions()).toBe(permissions);

  await permissions.sync(["posts.view", "posts.update"]);
  await permissions.createRole("editor", "tenant:7");
  await permissions.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.update"]);
  await permissions.grantRole({ type: "user", id: 1 }, "editor", "tenant:7");

  expect(await permissions.can({ type: "user", id: 1 }, "posts.update", "team:42")).toBe(true);
  expect(await permissions.can({ type: "user", id: 99 }, "posts.view", "team:42")).toBe(true);
  expect(await permissions.can({ type: "user", id: 2 }, "posts.update", "team:42")).toBe(false);

  // Counters live in the shared cache, so another process would see the change.
  expect(await Cache.get("perm:v:c:tenant:7")).toBeGreaterThan(0);
  expect(getMiddlewareAlias("permission")).toBeDefined();
  expect(await Gate.forUser({ id: 1 } as never).allows(undefined, "posts.update")).toBe(false); // default scope is global
});

test("cache: false falls back to in-process counters", async () => {
  const app = makeApp({ permissions: { cache: false } });
  app.register(PermissionServiceProvider);
  await app.boot();
  const permissions = app.make<Permissions>("permissions");
  await permissions.sync(["a.b"]);
  await permissions.grantPermission({ type: "user", id: 1 }, "a.b");
  expect(await permissions.can({ type: "user", id: 1 }, "a.b")).toBe(true);
});

test("migrations and config are publishable before the package is configured", () => {
  const app = makeApp({});
  app.register(PermissionServiceProvider);
  const entries = app.make<Array<{ group: string; from: string; to: string }>>("bunyad.publishing");
  const migrations = entries.filter((e) => e.group === "permissions-migrations");
  expect(migrations.map((e) => e.to)).toEqual([
    "database/migrations/2026_10_09_000000_create_permission_tables.ts",
    "database/migrations/2026_10_09_000100_add_permission_access_to_users_table.ts",
  ]);
  expect(entries.filter((e) => e.group === "permissions-config").map((e) => e.to)).toEqual(["config/permissions.ts"]);
  for (const entry of entries) expect(existsSync(entry.from)).toBe(true);
  expect(app.bound("permissions")).toBe(false);
});

test("table names come from config", async () => {
  const names = { permissions: "acl_permissions", roles: "acl_roles", role_permissions: "acl_role_permissions", grants: "acl_grants" };
  const other = connectSqlite();
  const { createPermissionTables } = await import("@bunyad/permissions");
  await createPermissionTables(schemaFor(other), names);
  const app = new Application({ basePath: process.cwd(), config: { app: { port: 0 }, permissions: { tables: names, cache: false } } });
  app.instance("db", other);
  app.register(PermissionServiceProvider);
  await app.boot();
  const permissions = app.make<Permissions>("permissions");
  await permissions.sync(["a.b"]);
  await permissions.grantPermission({ type: "user", id: 1 }, "a.b");
  expect(await permissions.can({ type: "user", id: 1 }, "a.b")).toBe(true);
  await other.close();
});
