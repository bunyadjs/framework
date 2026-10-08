import { afterAll, beforeAll, expect, test } from "bun:test";
import { Auth, Gate, TokenGuard, setTokenGuard } from "@bunyad/auth";
import { Request, getMiddlewareAlias, resolveMiddleware, type Next } from "@bunyad/http";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { HasPermissions, type PermissionMethods } from "./has-permissions.ts";
import { Permissions, setPermissions } from "./manager.ts";
import { createPermissionTables } from "./migration.ts";
import { installPermissionGate } from "./gate.ts";
import { permission, permissionAny, registerPermissionMiddleware, role } from "./middleware.ts";
import { ScopeTree } from "./scope.ts";

const connection = connectSqlite();
let permissions: Permissions;

@HasPermissions()
class User {
  constructor(public id: number) {}
}
interface User extends PermissionMethods {}

const ada = new User(1);
const bob = new User(2);

const next: Next = (async () => new Response("ok")) as Next;
const requestFor = (user: User | undefined, route: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const request = new Request(new globalThis.Request("http://localhost/x", { headers }));
  request.setRouteParams(route);
  if (user) request.user = user;
  return request;
};
const status = async (response: unknown) => (response as Response).status;

beforeAll(async () => {
  await createPermissionTables(schemaFor(connection));
  permissions = new Permissions({
    db: connection,
    scopes: new ScopeTree().parent("team", () => "tenant:7"),
    strict: true,
  });
  setPermissions(permissions);
  await permissions.sync(["posts.view", "posts.update", "invoices.view"]);
  await permissions.createRole("editor");
  await permissions.givePermissions({ name: "editor" }, ["posts.view", "posts.update"]);
  await permissions.createRole("lead", "team:42");
  await permissions.givePermissions({ name: "lead", scope: "team:42" }, ["invoices.view"]);
  await ada.grantRole("editor");
  await bob.grantRole("lead", "team:42");
});

afterAll(() => connection.close());

test("HasPermissions adds methods and a subject", async () => {
  expect(ada.permissionSubject()).toEqual({ type: "user", id: 1 });
  expect(await ada.can("posts.update")).toBe(true);
  expect(await ada.hasRole("editor")).toBe(true);
  expect(await ada.canAny(["invoices.view", "posts.view"])).toBe(true);
  expect(await ada.canAll(["invoices.view", "posts.view"])).toBe(false);
  expect(await ada.permissionNames()).toEqual(["posts.update", "posts.view"]);
  expect(Object.keys(ada)).toEqual(["id"]);
});

test("HasPermissions works as a mixin", async () => {
  class Base {
    constructor(public id: number) {}
  }
  const Account = HasPermissions(Base, { type: "account" });
  const account = new Account(5);
  expect((account as unknown as PermissionMethods).permissionSubject()).toEqual({ type: "account", id: 5 });
});

test("permission middleware: 401 guest, 403 without, passes with", async () => {
  const mw = permission(["posts.update"]);
  expect(await status(await mw.handle(requestFor(undefined), next))).toBe(401);
  expect(await status(await mw.handle(requestFor(bob), next))).toBe(403);
  expect(await status(await mw.handle(requestFor(ada), next))).toBe(200);

  const both = permission(["posts.update", "invoices.view"]);
  expect(await status(await both.handle(requestFor(ada), next))).toBe(403);
  const any = permissionAny(["posts.update", "invoices.view"]);
  expect(await status(await any.handle(requestFor(ada), next))).toBe(200);
});

test("scope comes from route parameters", async () => {
  const mw = permission(["invoices.view@team:{team}"]);
  expect(await status(await mw.handle(requestFor(bob, { team: "42" }), next))).toBe(200);
  expect(await status(await mw.handle(requestFor(bob, { team: "43" }), next))).toBe(403);
  const byRole = role(["lead@team:{team}"]);
  expect(await status(await byRole.handle(requestFor(bob, { team: "42" }), next))).toBe(200);
  expect(await status(await byRole.handle(requestFor(ada, { team: "42" }), next))).toBe(403);
});

test("aliases register as permission:, permission.any: and role:", async () => {
  registerPermissionMiddleware();
  expect(getMiddlewareAlias("permission")).toBeDefined();
  const resolved = resolveMiddleware("permission:posts.update") as unknown as {
    handle(request: Request, next: Next): Promise<Response>;
  };
  expect(await status(await resolved.handle(requestFor(ada), next))).toBe(200);
  expect(await status(await resolved.handle(requestFor(bob), next))).toBe(403);
  const anyOf = resolveMiddleware("permission.any:invoices.view,posts.view") as unknown as {
    handle(request: Request, next: Next): Promise<Response>;
  };
  expect(await status(await anyOf.handle(requestFor(ada), next))).toBe(200);
});

test("Gate allows held permission names and defers everything else", async () => {
  installPermissionGate(Gate);
  expect(await Gate.forUser(ada as never).allows(undefined, "posts.update")).toBe(true);
  expect(await Gate.forUser(bob as never).allows(undefined, "posts.update")).toBe(false);
  expect(await Gate.forUser(ada as never).allows(undefined, "not.a.permission")).toBe(false);
  Gate.define("posts.view", () => false);
  expect(await Gate.forUser(ada as never).allows(undefined, "posts.view")).toBe(true);
});

test("an API token can narrow its owner but never widen it", async () => {
  const users = new Map([[1, ada]]);
  const records = new Map<number, { id: number; tokenable_id: number; name: string; token: string; abilities?: string }>();
  let id = 1;
  setTokenGuard(
    new TokenGuard({
      retrieveTokenById: (tokenId) => records.get(tokenId) ?? null,
      retrieveUserById: (userId) => (users.get(Number(userId)) as never) ?? null,
      createTokenRecord: (data) => {
        const created = { id: id++, ...data } as never as { id: number; tokenable_id: number; name: string; token: string };
        records.set(created.id, created);
        return created.id;
      },
      deleteTokenRecord: (tokenId) => void records.delete(tokenId),
    }),
  );
  const narrow = await Auth.guard("token").createToken(ada as never, "narrow", { abilities: ["posts.view"] });
  const request = new Request(
    new globalThis.Request("http://localhost/api", { headers: { authorization: `Bearer ${narrow}` } }),
  );
  await Auth.guard("token").user(request);

  // Ada holds posts.update, but this token only carries posts.view.
  expect(await status(await permission(["posts.view"]).handle(request, next))).toBe(200);
  expect(await status(await permission(["posts.update"]).handle(request, next))).toBe(403);
  // Bob's permission that the token does not carry: still denied for ada's token.
  expect(await status(await permission(["invoices.view"]).handle(request, next))).toBe(403);
});
