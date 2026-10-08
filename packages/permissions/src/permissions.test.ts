import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { connectMysql, connectPostgres, connectSqlite, schemaFor, type Connection } from "@bunyad/database";
import { bitmapFromBase64, bitmapIds, bitmapToBase64, emptyBitmap, hasBit, orInto, setBit } from "./bitmap.ts";
import { definePermissions, patternCovers } from "./registry.ts";
import { Permissions } from "./manager.ts";
import { createPermissionTables, dropPermissionTables } from "./migration.ts";
import { GLOBAL_SCOPE, ScopeTree, scopeOf } from "./scope.ts";
import { MemoryVersionStore } from "./versions.ts";
import { UnknownPermissionError, type PermissionsDb, type SharedCache } from "./types.ts";

describe("bitmap", () => {
  test("set, has and grow across word boundaries", () => {
    let map = emptyBitmap(8);
    for (const id of [0, 31, 32, 63, 64, 200]) map = setBit(map, id);
    for (const id of [0, 31, 32, 63, 64, 200]) expect(hasBit(map, id)).toBe(true);
    expect(hasBit(map, 1)).toBe(false);
    expect(hasBit(map, 5000)).toBe(false);
    expect(bitmapIds(map)).toEqual([0, 31, 32, 63, 64, 200]);
  });

  test("or and base64 round trip", () => {
    const a = setBit(emptyBitmap(), 3);
    const b = setBit(emptyBitmap(100), 90);
    const merged = orInto(a, b);
    expect(bitmapIds(merged)).toEqual([3, 90]);
    expect(bitmapIds(bitmapFromBase64(bitmapToBase64(merged)))).toEqual([3, 90]);
  });
});

describe("definitions and scopes", () => {
  test("definePermissions flattens groups", () => {
    expect(definePermissions({ posts: ["view", "update"], invoices: { actions: ["void"], label: "Invoices" } })).toEqual([
      "posts.view",
      "posts.update",
      "invoices.void",
    ]);
  });

  test("patternCovers", () => {
    expect(patternCovers("*", "a.b")).toBe(true);
    expect(patternCovers("posts.*", "posts.view")).toBe(true);
    expect(patternCovers("posts.*", "postsx.view")).toBe(false);
    expect(patternCovers("posts.view", "posts.view")).toBe(true);
  });

  test("scope chain runs root to leaf and survives cycles", async () => {
    const tree = new ScopeTree()
      .parent("team", () => "tenant:7")
      .parent("tenant", () => "team:1");
    expect(await tree.chain("team:1")).toEqual([GLOBAL_SCOPE, "tenant:7", "team:1"]);
    expect(await new ScopeTree().chain("team:9")).toEqual([GLOBAL_SCOPE, "team:9"]);
    expect(await new ScopeTree().chain(GLOBAL_SCOPE)).toEqual([GLOBAL_SCOPE]);
  });
});

type Driver = { name: string; connection: Connection };

async function drivers(): Promise<Driver[]> {
  const list: Driver[] = [{ name: "sqlite", connection: connectSqlite() }];
  const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
  if (pg && /^(postgres|postgresql):\/\//i.test(pg)) list.push({ name: "postgres", connection: connectPostgres({ url: pg, max: 2 }) });
  const my = Bun.env.BUNYAD_TEST_MYSQL_URL;
  if (my && /^mysql:\/\//i.test(my)) list.push({ name: "mysql", connection: connectMysql({ url: my, tls: { rejectUnauthorized: false } }) });
  return list;
}

const all = await drivers();
afterAll(async () => {
  for (const driver of all) await driver.connection.close();
});

/** A db wrapper that counts statements, so tests can assert query budgets. */
function counting(connection: Connection) {
  const state = { reads: 0, writes: 0 };
  const db: PermissionsDb = {
    run: (sql, params) => {
      state.writes++;
      return connection.run(sql, params);
    },
    get: (sql, params) => {
      state.reads++;
      return connection.get(sql, params);
    },
    all: (sql, params) => {
      state.reads++;
      return connection.all(sql, params);
    },
    transaction: (fn) => connection.transaction(fn),
  };
  return { db, state, reset: () => ((state.reads = 0), (state.writes = 0)) };
}

class MapCache implements SharedCache {
  data = new Map<string, unknown>();
  get = (key: string) => (this.data.has(key) ? JSON.parse(this.data.get(key) as string) : undefined);
  put = (key: string, value: unknown) => void this.data.set(key, JSON.stringify(value));
}

const alice = { type: "user", id: 1 };
const bob = { type: "user", id: 2 };

describe.each(all.map((d) => [d.name, d] as const))("permissions (%s)", (_name, driver) => {
  const counter = counting(driver.connection);
  let perms: Permissions;
  let versions: MemoryVersionStore;
  let clock = 1_700_000_000_000;

  const make = (extra: Partial<ConstructorParameters<typeof Permissions>[0]> = {}) =>
    new Permissions({
      db: counter.db,
      versions,
      scopes: new ScopeTree().parent("team", (id) => (id === "42" || id === "43" ? "tenant:7" : null)),
      now: () => clock,
      strict: true,
      ...extra,
    });

  beforeEach(async () => {
    const schema = schemaFor(driver.connection);
    await dropPermissionTables(schema);
    await createPermissionTables(schema);
    versions = new MemoryVersionStore();
    perms = make();
    await perms.sync(definePermissions({ posts: ["view", "update", "delete"], invoices: ["view", "void"] }));
  });

  test("default deny, direct permission and role permission", async () => {
    expect(await perms.can(alice, "posts.view")).toBe(false);
    await perms.grantPermission(alice, "posts.view");
    expect(await perms.can(alice, "posts.view")).toBe(true);
    expect(await perms.can(alice, "posts.update")).toBe(false);

    await perms.createRole("editor");
    await perms.givePermissions({ name: "editor" }, ["posts.update", "posts.view"]);
    await perms.grantRole(bob, "editor");
    expect(await perms.can(bob, "posts.update")).toBe(true);
    expect(await perms.hasRole(bob, "editor")).toBe(true);
    expect(await perms.hasRole(alice, "editor")).toBe(false);
    expect(await perms.permissionNames(bob)).toEqual(["posts.update", "posts.view"]);
  });

  test("wildcards expand to concrete permissions, including ones added later", async () => {
    await perms.createRole("admin");
    await perms.givePermissions({ name: "admin" }, ["posts.*"]);
    await perms.grantRole(alice, "admin");
    expect(await perms.can(alice, "posts.delete")).toBe(true);
    expect(await perms.can(alice, "invoices.view")).toBe(false);

    await perms.sync(["posts.publish"]);
    expect(await perms.can(alice, "posts.publish")).toBe(true);

    await perms.grantPermission(bob, "*");
    expect(await perms.can(bob, "invoices.void")).toBe(true);
  });

  test("unknown permission throws in strict mode and denies otherwise", async () => {
    await expect(perms.can(alice, "nope.nothing")).rejects.toBeInstanceOf(UnknownPermissionError);
    const lenient = make({ strict: false });
    expect(await lenient.can(alice, "nope.nothing")).toBe(false);
    await expect(perms.grantPermission(alice, "nope.nothing")).rejects.toBeInstanceOf(UnknownPermissionError);
  });

  test("scopes: global roles apply below, team roles do not leak sideways", async () => {
    await perms.createRole("viewer");
    await perms.givePermissions({ name: "viewer" }, ["posts.view"]);
    await perms.createRole("lead", "team:42");
    await perms.givePermissions({ name: "lead", scope: "team:42" }, ["posts.delete"]);

    await perms.grantRole(alice, "viewer", GLOBAL_SCOPE);
    await perms.grantRole(bob, "lead", "team:42");

    expect(await perms.can(alice, "posts.view", "team:42")).toBe(true);
    expect(await perms.can(alice, "posts.view", scopeOf("team", 43))).toBe(true);
    expect(await perms.can(bob, "posts.delete", "team:42")).toBe(true);
    expect(await perms.can(bob, "posts.delete", "team:43")).toBe(false);
    expect(await perms.can(bob, "posts.delete", GLOBAL_SCOPE)).toBe(false);
  });

  test("a tenant grant covers its teams; a team role name shadows a global one", async () => {
    await perms.createRole("manager");
    await perms.givePermissions({ name: "manager" }, ["posts.view"]);
    await perms.createRole("manager", "tenant:7");
    await perms.givePermissions({ name: "manager", scope: "tenant:7" }, ["invoices.view"]);
    await perms.grantRole(alice, "manager", "tenant:7");
    expect(await perms.can(alice, "invoices.view", "team:42")).toBe(true);
    expect(await perms.can(alice, "posts.view", "team:42")).toBe(false);
  });

  test("expired grants stop working without any cleanup", async () => {
    await perms.grantPermission(alice, "posts.view", GLOBAL_SCOPE, { expiresAt: Math.floor(clock / 1000) + 60 });
    expect(await perms.can(alice, "posts.view")).toBe(true);
    clock += 120_000;
    expect(await perms.can(alice, "posts.view")).toBe(false);
  });

  test("super admin hook allows without touching the database", async () => {
    const admin = make({ superAdmin: (subject) => subject.id === 99 });
    counter.reset();
    expect(await admin.can({ type: "user", id: 99 }, "posts.view")).toBe(true);
    expect(counter.state.reads).toBe(0);
  });

  test("syncRoles is a diff and idempotent; revoke and delete take effect", async () => {
    await perms.createRole("a");
    await perms.createRole("b");
    await perms.createRole("c");
    expect(await perms.syncRoles(alice, ["a", "b"])).toEqual({ attached: ["a", "b"], detached: [] });
    expect(await perms.syncRoles(alice, ["b", "c"])).toEqual({ attached: ["c"], detached: ["a"] });
    expect(await perms.syncRoles(alice, ["b", "c"])).toEqual({ attached: [], detached: [] });
    await perms.deleteRole({ name: "c" });
    expect(await perms.hasRole(alice, "c")).toBe(false);
    expect(await perms.hasRole(alice, "b")).toBe(true);
    await perms.revokeRole(alice, "b");
    expect(await perms.hasRole(alice, "b")).toBe(false);
  });

  test("syncPermissions reports the diff", async () => {
    await perms.createRole("editor");
    await perms.givePermissions({ name: "editor" }, ["posts.view", "posts.update"]);
    expect(await perms.syncPermissions({ name: "editor" }, ["posts.update", "posts.delete"])).toEqual({
      attached: ["posts.delete"],
      detached: ["posts.view"],
    });
  });

  describe("query budget", () => {
    beforeEach(async () => {
      await perms.createRole("editor");
      await perms.givePermissions({ name: "editor" }, ["posts.update"]);
      await perms.grantRole(alice, "editor");
      perms = make({ consistency: "eventual", ttlMs: 60_000 });
    });

    test("cold check is one statement, warm check is zero", async () => {
      counter.reset();
      expect(await perms.can(alice, "posts.update")).toBe(true);
      // One permissions read for the registry plus the single combined grants+roles statement.
      expect(counter.state.reads).toBe(2);
      counter.reset();
      expect(await perms.can(alice, "posts.update")).toBe(true);
      expect(await perms.can(alice, "posts.view")).toBe(false);
      expect(counter.state.reads).toBe(0);
    });

    test("50 concurrent cold checks share one load", async () => {
      counter.reset();
      const results = await Promise.all(Array.from({ length: 50 }, () => perms.can(alice, "posts.update")));
      expect(results.every(Boolean)).toBe(true);
      expect(counter.state.reads).toBe(2);
    });

    test("a grant change costs the subject one grants-only statement", async () => {
      await perms.can(alice, "posts.update");
      await perms.can(bob, "posts.update");
      await perms.grantPermission(alice, "posts.view");
      counter.reset();
      expect(await perms.can(alice, "posts.view")).toBe(true);
      expect(counter.state.reads).toBe(1);
      counter.reset();
      expect(await perms.can(bob, "posts.update")).toBe(false);
      expect(counter.state.reads).toBe(0);
    });

    test("a role edit refreshes every member lazily", async () => {
      await perms.grantRole(bob, "editor");
      expect(await perms.can(bob, "posts.delete")).toBe(false);
      await perms.givePermissions({ name: "editor" }, ["posts.delete"]);
      expect(await perms.can(alice, "posts.delete")).toBe(true);
      expect(await perms.can(bob, "posts.delete")).toBe(true);
    });
  });

  test("two processes sharing counters and cache see each other's changes (strict)", async () => {
    const cache = new MapCache();
    const a = make({ cache, consistency: "strict" });
    const b = make({ cache, consistency: "strict" });
    await a.createRole("editor");
    await a.givePermissions({ name: "editor" }, ["posts.view"]);
    await a.grantRole(alice, "editor");
    expect(await b.can(alice, "posts.view")).toBe(true);
    await a.revokeRole(alice, "editor");
    expect(await b.can(alice, "posts.view")).toBe(false);
    await a.grantPermission(alice, "posts.update");
    expect(await b.can(alice, "posts.update")).toBe(true);
  });

  test("a warm shared cache avoids the database for a second process", async () => {
    const cache = new MapCache();
    const a = make({ cache, consistency: "strict" });
    await a.createRole("editor");
    await a.givePermissions({ name: "editor" }, ["posts.view"]);
    await a.grantRole(alice, "editor");
    await a.can(alice, "posts.view");
    const b = make({ cache, consistency: "strict" });
    counter.reset();
    expect(await b.can(alice, "posts.view")).toBe(true);
    // Only the registry rows are read: the effective set comes from the shared cache.
    expect(counter.state.reads).toBe(1);
  });
});

describe.each(all.map((d) => [d.name, d] as const))("tooling (%s)", (_name, driver) => {
  let perms: Permissions;
  let clock = 1_700_000_000_000;

  beforeEach(async () => {
    const schema = schemaFor(driver.connection);
    await dropPermissionTables(schema);
    await createPermissionTables(schema);
    perms = new Permissions({
      db: driver.connection,
      scopes: new ScopeTree().parent("team", () => "tenant:7"),
      now: () => clock,
      strict: true,
    });
    await perms.sync(definePermissions({ posts: ["view", "update"], invoices: ["view"] }));
  });

  test("copyRoles copies roles with their permissions and is idempotent", async () => {
    await perms.createRole("editor");
    await perms.givePermissions({ name: "editor" }, ["posts.*"]);
    await perms.createRole("viewer");
    await perms.givePermissions({ name: "viewer" }, ["posts.view"]);

    const first = await perms.copyRoles(GLOBAL_SCOPE, "tenant:9");
    expect(first.map((r) => r.name).sort()).toEqual(["editor", "viewer"]);
    await perms.copyRoles(GLOBAL_SCOPE, "tenant:9");

    await perms.grantRole(alice, "editor", "tenant:9");
    expect(await perms.can(alice, "posts.update", "tenant:9")).toBe(true);
    expect(await perms.can(alice, "posts.update", "tenant:8")).toBe(false);
    // Editing the copy does not touch the template.
    await perms.revokePermissions({ name: "editor", scope: "tenant:9" }, ["posts.*"]);
    expect(await perms.can(alice, "posts.update", "tenant:9")).toBe(false);
    await perms.grantRole(bob, "editor");
    expect(await perms.can(bob, "posts.update")).toBe(true);
  });

  test("whoCan finds holders through roles, wildcards and direct grants, in scope", async () => {
    await perms.createRole("editor");
    await perms.givePermissions({ name: "editor" }, ["posts.update"]);
    await perms.createRole("admin", "tenant:7");
    await perms.givePermissions({ name: "admin", scope: "tenant:7" }, ["posts.*"]);
    await perms.grantRole(alice, "editor");
    await perms.grantRole(bob, "admin", "tenant:7");
    await perms.grantPermission({ type: "user", id: 3 }, "posts.update", "team:42");
    await perms.grantPermission({ type: "user", id: 4 }, "invoices.view");

    expect(await perms.whoCan("posts.update", "team:42")).toEqual(["1", "2", "3"]);
    expect(await perms.whoCan("posts.update", "tenant:7")).toEqual(["1", "2"]);
    // Every team of tenant 7 sits under the tenant admin in this setup.
    expect(await perms.whoCan("posts.update", "team:99")).toEqual(["1", "2"]);
    expect(await perms.whoCan("invoices.view")).toEqual(["4"]);
    expect(await perms.whoCan("posts.update", "team:42", { limit: 2 })).toEqual(["1", "2"]);
  });

  test("explain says which grant allowed the check", async () => {
    await perms.createRole("editor");
    await perms.givePermissions({ name: "editor" }, ["posts.*"]);
    await perms.grantRole(alice, "editor", "tenant:7");
    await perms.grantPermission(alice, "posts.update", "team:42");

    const result = await perms.explain(alice, "posts.update", "team:42");
    expect(result.allowed).toBe(true);
    expect(result.via).toEqual([
      { kind: "role", name: "editor", scope: "tenant:7" },
      { kind: "permission", name: "posts.update", scope: "team:42" },
    ]);
    expect((await perms.explain(bob, "posts.update", "team:42")).allowed).toBe(false);
  });

  test("pruneExpired removes only expired grants; orphans are reported", async () => {
    await perms.grantPermission(alice, "posts.view", GLOBAL_SCOPE, { expiresAt: Math.floor(clock / 1000) - 10 });
    await perms.grantPermission(alice, "posts.update");
    expect(await perms.pruneExpired()).toBe(1);
    expect(await perms.can(alice, "posts.update")).toBe(true);
    expect(await perms.orphans(["posts.view", "posts.update"])).toEqual(["invoices.view"]);
  });

  test("doctor counts grants that point at nothing", async () => {
    await perms.createRole("ghost");
    await perms.grantRole(alice, "ghost");
    await driver.connection.run("DELETE FROM roles WHERE name = ?", ["ghost"]);
    expect(await perms.store.danglingGrantCount()).toEqual({ roles: 1, permissions: 0 });
  });
});
