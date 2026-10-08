import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Attribute, Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

/** A value object stored as integer cents. */
class Money {
  constructor(readonly cents: number, readonly currency = "USD") {}
  plus(other: Money) { return new Money(this.cents + other.cents, this.currency); }
  toString() { return `${this.currency} ${(this.cents / 100).toFixed(2)}`; }
  toJSON() { return { amount: this.cents / 100, currency: this.currency }; }
}

class VoInvoice extends Model {
  static table = "vo_invoices";
  static fillable = ["title", "total", "tags_csv"];
  static casts() {
    return {
      total: Attribute.make({
        get: (value: unknown) => (value == null ? null : new Money(Number(value))),
        set: (value: unknown) => (value instanceof Money ? value.cents : value),
      }),
      tags_csv: Attribute.make({
        get: (value: unknown) => (typeof value === "string" && value ? value.split(",") : []),
        set: (value: unknown) => (Array.isArray(value) ? value.join(",") : value),
      }),
    };
  }
  declare id: number;
  declare title: string;
  declare total: Money | null;
  declare tags_csv: string[];
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "value objects through Attribute.make (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("vo_invoices");
      await schema.create("vo_invoices", (t) => { t.id(); t.string("title"); t.integer("total").nullable(); t.string("tags_csv").nullable(); t.timestamps(); });
    });
    afterAll(async () => { await schemaFor(c).dropIfExists("vo_invoices"); });
    const stored = async (id: number) => (await c.all<Record<string, unknown>>("SELECT total, tags_csv FROM vo_invoices WHERE id = ?", [id]))[0]!;

    test("a value object is stored as its raw form and hydrated back into the object", async () => {
      const made = (await VoInvoice.create({ title: "a", total: new Money(1250), tags_csv: ["x", "y"] })) as VoInvoice;
      const row = await stored(made.id);
      expect([Number(row.total), row.tags_csv]).toEqual([1250, "x,y"]);
      const loaded = (await VoInvoice.find(made.id)) as VoInvoice;
      expect(loaded.total).toBeInstanceOf(Money);
      expect(loaded.total!.cents).toBe(1250);
      expect(loaded.total!.plus(new Money(50)).toString()).toBe("USD 13.00");
      expect(loaded.tags_csv).toEqual(["x", "y"]);
    });

    test("assigning a new value object saves it; saving without touching it does not rewrite it", async () => {
      const made = (await VoInvoice.create({ title: "b", total: new Money(100) })) as VoInvoice;
      const loaded = (await VoInvoice.find(made.id)) as VoInvoice;
      expect(loaded.isDirty()).toBe(false);
      loaded.total = loaded.total!.plus(new Money(900));
      expect(loaded.isDirty("total")).toBe(true);
      await loaded.save();
      expect(Number((await stored(made.id)).total)).toBe(1000);
      expect(((await VoInvoice.find(made.id)) as VoInvoice).total!.cents).toBe(1000);
    });

    test("null stays null and serialization uses the object's toJSON", async () => {
      const made = (await VoInvoice.create({ title: "c" })) as VoInvoice;
      expect(((await VoInvoice.find(made.id)) as VoInvoice).total).toBeNull();
      const withTotal = (await VoInvoice.find((await VoInvoice.create({ title: "d", total: new Money(500) }) as VoInvoice).id)) as VoInvoice;
      expect(JSON.parse(JSON.stringify(withTotal)).total).toEqual({ amount: 5, currency: "USD" });
    });

    test("where() compares the raw stored form", async () => {
      await VoInvoice.create({ title: "e", total: new Money(777) });
      expect((await VoInvoice.where("total", 777).get()).pluck("title").all()).toEqual(["e"]);
    });
  },
);
