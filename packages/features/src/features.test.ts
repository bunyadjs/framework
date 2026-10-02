import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { HttpException } from "@bunyad/http";
import {
  ArrayFeatureStore,
  DatabaseFeatureStore,
  Feature,
  FeatureManager,
  ensureFeaturesAreActive,
  setFeatures,
  type FeatureConnection,
} from "./index.ts";

type TestMiddleware = (
  request: never,
  next: () => Promise<Response>,
) => Promise<Response>;

afterEach(() => {
  Feature.restore();
});

describe("Feature define / active / value", () => {
  test("boolean definition resolves and stores", async () => {
    Feature.define("new-api", true);
    expect(await Feature.active("new-api")).toBe(true);
    expect(await Feature.value("new-api")).toBe(true);
  });

  test("resolver receives scope", async () => {
    Feature.define("beta", (scope: unknown) => {
      const user = scope as { id: number } | null;
      return user?.id === 1;
    });

    expect(await Feature.for({ id: 1 }).active("beta")).toBe(true);
    expect(await Feature.for({ id: 2 }).active("beta")).toBe(false);
  });

  test("rich values are active", async () => {
    Feature.define("purchase-button", () => "seafoam-green");
    expect(await Feature.active("purchase-button")).toBe(true);
    expect(await Feature.value("purchase-button")).toBe("seafoam-green");
  });

  test("activate and deactivate override definition", async () => {
    Feature.define("flag", false);
    expect(await Feature.active("flag")).toBe(false);

    await Feature.activate("flag");
    expect(await Feature.active("flag")).toBe(true);

    await Feature.deactivate("flag");
    expect(await Feature.active("flag")).toBe(false);
  });

  test("forget re-resolves from definition", async () => {
    let calls = 0;
    Feature.define("once", () => {
      calls += 1;
      return calls === 1;
    });

    expect(await Feature.active("once")).toBe(true);
    expect(calls).toBe(1);
    expect(await Feature.active("once")).toBe(true);
    expect(calls).toBe(1);

    await Feature.forget("once");
    expect(await Feature.active("once")).toBe(false);
    expect(calls).toBe(2);
  });

  test("purge clears stored values", async () => {
    Feature.define("a", true);
    Feature.define("b", true);
    await Feature.active("a");
    await Feature.active("b");
    await Feature.purge("a");
    await Feature.activate("a", false);
    // after purge+activate false
    expect(await Feature.active("a")).toBe(false);
    expect(await Feature.active("b")).toBe(true);
  });

  test("when helper", async () => {
    Feature.define("on", true);
    Feature.define("off", false);

    const a = await Feature.when(
      "on",
      () => "yes",
      () => "no",
    );
    const b = await Feature.when(
      "off",
      () => "yes",
      () => "no",
    );
    expect(a).toBe("yes");
    expect(b).toBe("no");
  });

  test("allAreActive / someAreActive", async () => {
    Feature.define("x", true);
    Feature.define("y", false);
    expect(await Feature.allAreActive(["x", "y"])).toBe(false);
    expect(await Feature.someAreActive(["x", "y"])).toBe(true);
    expect(await Feature.allAreInactive(["y"])).toBe(true);
  });

  test("undefined feature throws", async () => {
    await expect(Feature.active("missing")).rejects.toThrow(/not defined/);
  });
});

describe("Feature.fake", () => {
  test("assertActive / assertInactive", async () => {
    const fake = Feature.fake();
    fake.define("dash", true);
    await fake.assertActive("dash");
    await fake.deactivate("dash");
    await fake.assertInactive("dash");
  });
});

describe("DatabaseFeatureStore", () => {
  test("persists across managers", async () => {
    const sqlite = new Database(":memory:");
    sqlite.run(`
      CREATE TABLE features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scope TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(name, scope)
      )
    `);

    const connection = {
      run: (sql: string, params: unknown[] = []) => {
        sqlite.run(sql, params as never[]);
      },
      get: <T extends Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => sqlite.query(sql).get(...(params as never[])) as T | null,
      all: <T extends Record<string, unknown>>(
        sql: string,
        params: unknown[] = [],
      ) => sqlite.query(sql).all(...(params as never[])) as T[],
    };

    const store = new DatabaseFeatureStore({ connection: connection as unknown as FeatureConnection });
    const a = new FeatureManager(store);
    a.define("db-flag", (scope: unknown) => (scope as { id: number }).id > 0);
    setFeatures(a);

    expect(await Feature.for({ id: 7 }).active("db-flag")).toBe(true);

    const b = new FeatureManager(store);
    b.define("db-flag", false);
    setFeatures(b);
    // Stored value from first resolution wins over new definition
    expect(await Feature.for({ id: 7 }).active("db-flag")).toBe(true);

    await Feature.for({ id: 7 }).forget("db-flag");
    expect(await Feature.for({ id: 7 }).active("db-flag")).toBe(false);
  });
});

describe("ArrayFeatureStore", () => {
  test("purge by name", async () => {
    const store = new ArrayFeatureStore();
    await store.set("a", "", true);
    await store.set("b", "", true);
    await store.purge("a");
    expect(await store.get("a", "")).toBeUndefined();
    expect(await store.get("b", "")).toBe(true);
  });
});

describe("ensureFeaturesAreActive middleware", () => {
  test("passes when features active", async () => {
    Feature.define("dash", true);
    const mw = ensureFeaturesAreActive("dash") as unknown as TestMiddleware;
    let called = false;
    const res = await mw({} as never, async () => {
      called = true;
      return new Response("ok");
    });
    expect(called).toBe(true);
    expect(res.status).toBe(200);
  });

  test("throws 400 when feature inactive", async () => {
    Feature.define("off", false);
    const mw = ensureFeaturesAreActive("off") as unknown as TestMiddleware;
    await expect(
      mw({} as never, async () => new Response("ok")),
    ).rejects.toBeInstanceOf(HttpException);
    try {
      await mw({} as never, async () => new Response("ok"));
    } catch (e) {
      expect((e as HttpException).status).toBe(400);
    }
  });
});
