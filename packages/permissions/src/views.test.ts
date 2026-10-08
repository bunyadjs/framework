import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Gate } from "@bunyad/auth";
import { Request, resolveMiddleware, type Next } from "@bunyad/http";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { compile, setViewAuthHelpers } from "@bunyad/view";
import { installPermissionGate } from "./gate.ts";
import { HasPermissions, type PermissionMethods } from "./has-permissions.ts";
import { Permissions, setPermissions } from "./manager.ts";
import { createPermissionTables } from "./migration.ts";
import { registerPermissionMiddleware } from "./middleware.ts";
import { ScopeTree } from "./scope.ts";
import { stubPath } from "./stubs.ts";

const connection = connectSqlite();
afterAll(() => connection.close());

@HasPermissions({ type: "user" })
class User {
  constructor(public id: number) {}
}
interface User extends PermissionMethods {}

const ada = new User(1);
const bob = new User(2);
let current: User | null = null;
let permissions: Permissions;

beforeAll(async () => {
  await createPermissionTables(schemaFor(connection));
  permissions = new Permissions({
    db: connection,
    scopes: new ScopeTree().parent("team", () => "tenant:7"),
    defaultScope: () => "tenant:7",
    strict: true,
  });
  setPermissions(permissions);
  await permissions.sync(["posts.view", "posts.update"]);
  await permissions.createRole("editor", "tenant:7");
  await permissions.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.update"]);
  await ada.grantRole("editor", "tenant:7");
});

beforeEach(() => {
  Gate.flush();
  installPermissionGate(Gate);
  // The same wiring the framework's auth provider does for views.
  setViewAuthHelpers({
    can: (ability, ...args) => Gate.forUser(current as never).allowsSync(undefined, ability, ...args),
    cannot: (ability, ...args) => !Gate.forUser(current as never).allowsSync(undefined, ability, ...args),
  });
  current = ada;
});

afterAll(() => {
  setViewAuthHelpers(null);
  setPermissions(undefined);
});

test("@can answers from memory once the user is loaded, and says no before that", async () => {
  const view = compile(`@can('posts.update')yes@endcan`);
  const fresh = new Permissions({ db: connection, scopes: new ScopeTree(), defaultScope: () => "tenant:7", strict: true });
  setPermissions(fresh);
  expect(view({})).toBe(""); // nothing in memory yet: views cannot wait
  await fresh.load(ada);
  expect(view({})).toBe("yes");
  setPermissions(permissions);
});

test("directives: @can, @cannot, roles, and an explicit scope", async () => {
  await permissions.load(ada);
  await permissions.load(ada, "team:42");
  expect(compile(`@can('posts.update')yes@endcan`)({})).toBe("yes");
  expect(compile(`@can('posts.view')yes@endcan`)({})).toBe("");
  expect(compile(`@cannot('posts.view')no@endcannot`)({})).toBe("no");
  expect(compile(`@can('role:editor')admin@endcan`)({})).toBe("admin");
  expect(compile(`@can('role:owner')owner@endcan`)({})).toBe("");
  expect(compile(`@can('posts.update', 'team:42')team@endcan`)({})).toBe("team");
  expect(compile(`@can('posts.update', 'team:9')x@endcan`)({})).toBe("");
});

test("a user without the permission is told no, and policies still decide model abilities", async () => {
  current = bob;
  await permissions.load(bob);
  expect(compile(`@can('posts.update')yes@endcan`)({})).toBe("");
  Gate.define("update", (user: unknown, post: unknown) => (post as { owner: number }).owner === (user as User).id);
  current = ada;
  expect(compile(`@can('update', post)own@endcan`)({ post: { owner: 1 } })).toBe("own");
  expect(compile(`@can('update', post)own@endcan`)({ post: { owner: 2 } })).toBe("");
});

test("permissions.load middleware warms the user for the page", async () => {
  registerPermissionMiddleware(() => permissions);
  const fresh = new Permissions({ db: connection, scopes: new ScopeTree(), defaultScope: () => "tenant:7", strict: true });
  setPermissions(fresh);
  Gate.flush();
  installPermissionGate(Gate, () => fresh);
  registerPermissionMiddleware(() => fresh);

  const request = new Request(new globalThis.Request("http://localhost/"));
  request.user = ada;
  const view = compile(`@can('posts.update')yes@endcan`);
  expect(view({})).toBe("");
  const mw = resolveMiddleware("permissions.load") as unknown as { handle(request: Request, next: Next): Promise<Response> };
  await mw.handle(request, (async () => new Response("ok")) as Next);
  expect(view({})).toBe("yes");

  // A guest passes straight through.
  const guest = new Request(new globalThis.Request("http://localhost/"));
  expect((await mw.handle(guest, (async () => new Response("ok")) as Next)).status).toBe(200);
  setPermissions(permissions);
});

test("tables can be renamed", async () => {
  const names = { permissions: "acl_permissions", roles: "acl_roles", role_permissions: "acl_role_permissions", grants: "acl_grants" };
  const other = connectSqlite();
  await createPermissionTables(schemaFor(other), names);
  const renamed = new Permissions({ db: other, tables: names, strict: true });
  await renamed.sync(["a.b"]);
  await renamed.createRole("r");
  await renamed.givePermissions({ name: "r" }, ["a.b"]);
  await renamed.grantRole({ type: "user", id: 1 }, "r");
  expect(await renamed.can({ type: "user", id: 1 }, "a.b")).toBe(true);
  expect(await renamed.whoCan("a.b")).toEqual(["1"]);
  const tables = (await other.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  expect(tables).toContain("acl_grants");
  expect(tables).not.toContain("grants");
  await other.close();
  expect(() => new Permissions({ db: other, tables: { roles: "roles; DROP TABLE x" } })).toThrow(/Invalid table name/);
});

test("the published migration stubs create working tables and the users column", async () => {
  const fresh = connectSqlite();
  const schema = schemaFor(fresh);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
  });
  for (const file of ["2026_10_09_000000_create_permission_tables.ts", "2026_10_09_000100_add_permission_access_to_users_table.ts"]) {
    expect(existsSync(stubPath(file))).toBe(true);
    const migration = (await import(stubPath(file))) as { up(s: typeof schema): Promise<void>; down(s: typeof schema): Promise<void> };
    await migration.up(schema);
  }
  expect(await schema.hasColumn("users", "permission_access")).toBe(true);
  const p = new Permissions({ db: fresh, columns: { user: { table: "users", column: "permission_access" } }, strict: true });
  await p.sync(["x.y"]);
  await fresh.run("INSERT INTO users (id, name) VALUES (1, 'a')");
  await p.grantPermission({ type: "user", id: 1 }, "x.y");
  expect(await p.can({ type: "user", id: 1 }, "x.y")).toBe(true);
  const down = (await import(stubPath("2026_10_09_000000_create_permission_tables.ts"))) as { down(s: typeof schema): Promise<void> };
  await down.down(schema);
  const left = (await fresh.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
  expect(left).not.toContain("grants");
  expect(left).toContain("users");
  expect(existsSync(stubPath("permissions.ts"))).toBe(true);
  await fresh.close();
});
