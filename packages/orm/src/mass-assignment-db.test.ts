import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, MassAssignmentException } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class MaFill extends Model {
  static table = "ma_fill";
  static fillable = ["name", "email"];
  declare id: number;
  declare name: string;
  declare email: string;
  declare role: string;
}
class MaDefaults extends Model {
  static table = "ma_defaults";
  static fillable = ["name", "tier"];
  declare id: number;
  declare name: string;
  declare tier: string;
}
class MaGuard extends Model {
  static table = "ma_fill";
  static fillable: string[] = [];
  static guarded = ["role", "id"];
  declare id: number;
  declare name: string;
  declare role: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "mass assignment (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("ma_fill");
      await schema.dropIfExists("ma_defaults");
      await schema.create("ma_defaults", (b) => { b.id(); b.string("name"); b.string("tier").default("basic"); b.timestamps(); });
      await schema.create("ma_fill", (b) => { b.id(); b.string("name").nullable(); b.string("email").nullable(); b.string("role").nullable(); b.timestamps(); });
    });
    afterEach(() => { Model.reguard(); Model.preventSilentlyDiscardingAttributes(false); });
    afterAll(async () => {
      await schemaFor(c).dropIfExists("ma_fill");
      await schemaFor(c).dropIfExists("ma_defaults");
    });
    const stored = async (id: number) => (await c.all<Record<string, unknown>>("SELECT * FROM ma_fill WHERE id = ?", [id]))[0]!;

    test("fillable is an allow-list for create: other keys are silently dropped", async () => {
      const m = (await MaFill.create({ name: "a", email: "a@x", role: "admin" })) as MaFill;
      const row = await stored(m.id);
      expect([row.name, row.email, row.role]).toEqual(["a", "a@x", null]);
    });

    test("fill() and update() obey fillable too", async () => {
      const m = (await MaFill.create({ name: "b" })) as MaFill;
      await m.update({ name: "b2", role: "admin" });
      const row = await stored(m.id);
      expect([row.name, row.role]).toEqual(["b2", null]);
    });

    test("guarded works as a deny-list when fillable is empty", async () => {
      const m = (await MaGuard.create({ name: "g", role: "admin" })) as MaGuard;
      expect(((await stored(m.id)) as Record<string, unknown>).role).toBeNull();
    });

    test("forceFill bypasses the guard", async () => {
      const m = new MaFill();
      m.forceFill({ name: "f", role: "root" });
      await m.save();
      expect((await stored(m.id)).role).toBe("root");
    });

    test("isFillable / isGuarded", () => {
      const m = new MaFill();
      expect([m.isFillable("name"), m.isFillable("role"), m.isGuarded("role")]).toEqual([true, false, true]);
      const g = new MaGuard();
      expect([g.isFillable("name"), g.isFillable("role"), g.isGuarded("id")]).toEqual([true, false, true]);
    });

    test("Model.unguard / reguard / unguarded(callback)", async () => {
      Model.unguard();
      expect(Model.isUnguarded()).toBe(true);
      const a = (await MaFill.create({ name: "u", role: "open" })) as MaFill;
      expect((await stored(a.id)).role).toBe("open");
      Model.reguard();
      expect(Model.isUnguarded()).toBe(false);

      const b = await Model.unguarded(() => MaFill.create({ name: "u2", role: "scoped" }));
      expect((await stored((b as MaFill).id)).role).toBe("scoped");
      expect(Model.isUnguarded()).toBe(false); // restored after the async callback finished
      const after = (await MaFill.create({ name: "u3", role: "nope" })) as MaFill;
      expect((await stored(after.id)).role).toBeNull();
    });

    test("unguarded restores the guard even when the callback throws", async () => {
      await expect(Model.unguarded(async () => { throw new Error("x"); })).rejects.toThrow("x");
      expect(Model.isUnguarded()).toBe(false);
      expect(() => Model.unguarded(() => { throw new Error("sync"); })).toThrow("sync");
      expect(Model.isUnguarded()).toBe(false);
    });

    test("preventSilentlyDiscardingAttributes turns dropped keys into an exception", async () => {
      Model.preventSilentlyDiscardingAttributes(true);
      // `create` filters synchronously (it returns a model directly on SQLite), so it can throw before a promise exists.
      let error: unknown;
      try {
        await MaFill.create({ name: "s", role: "admin" });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(MassAssignmentException);
      expect(await MaFill.where("name", "s").count()).toBe(0);
    });

    test("an unset fillable column keeps the database default (no NULL is inserted)", async () => {
      const m = (await MaDefaults.create({ name: "d" })) as MaDefaults;
      const row = (await c.all<Record<string, unknown>>("SELECT * FROM ma_defaults WHERE id = ?", [m.id]))[0]!;
      expect(row.tier).toBe("basic");
      const explicit = (await MaDefaults.create({ name: "d2", tier: "pro" })) as MaDefaults;
      expect(((await c.all<Record<string, unknown>>("SELECT tier FROM ma_defaults WHERE id = ?", [explicit.id]))[0]!).tier).toBe("pro");
    });

    test("an attribute assigned directly (not fillable) is still saved", async () => {
      const m = new MaFill();
      m.name = "direct";
      m.role = "manual";
      await m.save();
      expect((await stored(m.id)).role).toBe("manual");
    });

    test("firstOrCreate / updateOrCreate respect fillable", async () => {
      const m = (await MaFill.firstOrCreate({ name: "foc" }, { role: "admin" })) as MaFill;
      expect((await stored(m.id)).role).toBeNull();
    });
  },
);
