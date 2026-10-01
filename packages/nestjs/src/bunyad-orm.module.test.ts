import { describe, expect, test } from "bun:test";
import {
  DatabaseManager,
  getDefaultConnection,
  type Connection,
} from "@bunyad/database";
import { BunyadOrmModule } from "./bunyad-orm.module.ts";
import { BunyadOrmLifecycle } from "./lifecycle.ts";
import { resolveModuleOptions } from "./options.ts";
import { BUNYAD_CONNECTION, BUNYAD_ORM_MODULE_OPTIONS } from "./tokens.ts";

describe("BunyadOrmModule", () => {
  test("resolveModuleOptions defaults global + setAsDefault", () => {
    const resolved = resolveModuleOptions({
      driver: "sqlite",
      path: ":memory:",
    });
    expect(resolved.global).toBe(true);
    expect(resolved.setAsDefault).toBe(true);
    expect(resolved.driver).toBe("sqlite");
  });

  test("forRoot returns DynamicModule with Connection + DatabaseManager", () => {
    const mod = BunyadOrmModule.forRoot({
      driver: "sqlite",
      path: ":memory:",
    });
    expect(mod.module).toBe(BunyadOrmModule);
    expect(mod.global).toBe(true);
    expect(mod.exports).toEqual([BUNYAD_CONNECTION, DatabaseManager]);
    const providers = mod.providers ?? [];
    expect(providers.length).toBeGreaterThanOrEqual(3);
    expect(
      providers.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "provide" in p &&
          p.provide === BUNYAD_ORM_MODULE_OPTIONS,
      ),
    ).toBe(true);
    expect(
      providers.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "provide" in p &&
          p.provide === BUNYAD_CONNECTION,
      ),
    ).toBe(true);
    expect(
      providers.some(
        (p) =>
          typeof p === "object" &&
          p !== null &&
          "provide" in p &&
          p.provide === DatabaseManager,
      ),
    ).toBe(true);
    expect(providers).toContain(BunyadOrmLifecycle);
  });

  test("forRoot connection factory opens sqlite and sets default", async () => {
    const mod = BunyadOrmModule.forRoot({
      driver: "sqlite",
      path: ":memory:",
    });
    const providers = mod.providers ?? [];
    const optionsProvider = providers.find(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        "provide" in p &&
        p.provide === BUNYAD_ORM_MODULE_OPTIONS &&
        "useValue" in p,
    ) as { useValue: ReturnType<typeof resolveModuleOptions> };
    const connectionProvider = providers.find(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        "provide" in p &&
        p.provide === BUNYAD_CONNECTION &&
        "useFactory" in p,
    ) as {
      useFactory: (opts: typeof optionsProvider.useValue) => Connection;
    };

    const connection = connectionProvider.useFactory(optionsProvider.useValue);
    try {
      expect(connection.getDriverName()).toBe("sqlite");
      expect(getDefaultConnection()).toBe(connection);
      await connection.exec(
        "CREATE TABLE nest_smoke (id INTEGER PRIMARY KEY, name TEXT)",
      );
      await connection.run("INSERT INTO nest_smoke (name) VALUES (?)", [
        "ok",
      ]);
      const row = await connection.get<{ name: string }>(
        "SELECT name FROM nest_smoke WHERE name = ?",
        ["ok"],
      );
      expect(row?.name).toBe("ok");
    } finally {
      await connection.close();
    }
  });

  test("forRootAsync requires a factory source", () => {
    expect(() => BunyadOrmModule.forRootAsync({})).toThrow(/useFactory/);
  });

  test("forRootAsync useFactory wires options provider", async () => {
    const mod = BunyadOrmModule.forRootAsync({
      useFactory: () => ({ driver: "sqlite" as const, path: ":memory:" }),
      global: false,
    });
    expect(mod.global).toBe(false);
    const providers = mod.providers ?? [];
    const optionsProvider = providers.find(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        "provide" in p &&
        p.provide === BUNYAD_ORM_MODULE_OPTIONS &&
        "useFactory" in p,
    ) as {
      useFactory: (...args: unknown[]) => Promise<unknown> | unknown;
    };
    const resolved = (await optionsProvider.useFactory()) as ReturnType<
      typeof resolveModuleOptions
    >;
    expect(resolved.driver).toBe("sqlite");
    expect(resolved.setAsDefault).toBe(true);
    expect(resolved.global).toBe(false);
  });
});
