import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

describe.each(drivers.map((d) => [d.name, d] as const))(
  "save() timestamps follow Laravel (%s)",
  (_name, driver) => {
    class Note extends Model {
      static table = "st_notes";
      static fillable = ["body"];
      declare id: number;
      declare body: string;
      declare updated_at: string;
    }
    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      await schema.dropIfExists("st_notes");
      await schema.create("st_notes", (b) => { b.id(); b.string("body"); b.timestamps(); });
    });
    afterAll(async () => {
      await schemaFor(driver.connection).dropIfExists("st_notes");
    });

    const stored = async (id: number) =>
      (await driver.connection.all<Record<string, unknown>>("SELECT updated_at FROM st_notes WHERE id = ?", [id]))[0]!.updated_at;

    test("no-op save does not touch updated_at or report changes", async () => {
      const n = await Note.create({ body: "a" });
      const before = iso(await stored(n.id));
      await sleep(1100);
      await n.save();
      expect(iso(await stored(n.id))).toBe(before);
      expect(n.wasChanged()).toBe(false);
      expect(n.getChanges()).toEqual({});
    });

    test("dirty save bumps updated_at", async () => {
      const n = await Note.create({ body: "a" });
      const before = iso(await stored(n.id));
      await sleep(1100);
      n.body = "b";
      await n.save();
      expect(iso(await stored(n.id))).not.toBe(before);
      expect(n.wasChanged("body", "updated_at")).toBe(true);
    });

    test("an explicitly set updated_at is kept", async () => {
      const n = await Note.create({ body: "a" });
      n.body = "c";
      n.updated_at = "2020-01-02 03:04:05";
      await n.save();
      expect(iso(await stored(n.id))).toContain("2020-01-02");
    });
  },
);
