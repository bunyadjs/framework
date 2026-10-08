import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { castFromStorage, castToStorage } from "./casts.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class CeRow extends Model {
  static table = "ce_rows";
  static fillable = ["data", "price", "big", "on_date", "flag"];
  static casts() {
    return {
      data: "json" as const,
      price: "decimal:2" as const,
      big: "bigint" as const,
      on_date: "date" as const,
      flag: "boolean" as const,
    };
  }
  declare id: number;
  declare data: unknown;
  declare price: string;
  declare big: bigint;
  declare on_date: Date;
  declare flag: boolean;
}

describe("cast conversions", () => {
  test("json always encodes, so a plain string reads back as the same string", () => {
    for (const value of ["hello", "5", "", "true", 5, true, [1, "a"], { a: { b: 1 } }]) {
      const stored = castToStorage(value, "json") as string;
      expect(castFromStorage(stored, "json")).toEqual(value);
    }
  });

  test("an empty stored string reads as null for json and array", () => {
    expect(castFromStorage("", "json")).toBeNull();
    expect(castFromStorage("", "array")).toBeNull();
  });

  test("corrupt json fails loudly instead of returning a guess", () => {
    expect(() => castFromStorage("{bad", "json")).toThrow();
  });

  test("decimal:N rounds half away from zero on the decimal text", () => {
    expect(castToStorage("1.005", "decimal:2")).toBe("1.01");
    expect(castToStorage(2.675, "decimal:2")).toBe("2.68");
    expect(castToStorage(-1.005, "decimal:2")).toBe("-1.01");
    expect(castToStorage(10, "decimal:2")).toBe("10.00");
    expect(castToStorage(0.1 + 0.2, "decimal:2")).toBe("0.30");
    expect(castFromStorage("19.999", "decimal:2")).toBe("20.00");
  });

  test("an invalid date is rejected on write, never stored as NaN", () => {
    expect(() => castToStorage("not a date", "date")).toThrow(/not a valid date/);
    expect(() => castToStorage("not a date", "datetime")).toThrow(/not a valid date/);
    expect(() => castToStorage("not a date", "datetime", "postgres")).toThrow();
  });
});

describe.each(drivers.map((d) => [d.name, d] as const))("cast edge cases against the database (%s)", (_name, driver) => {
  const c = driver.connection;
  beforeAll(async () => {
    Model.setConnection(c);
    const schema = schemaFor(c);
    await schema.dropIfExists("ce_rows");
    await schema.create("ce_rows", (b) => {
      b.id();
      b.text("data").nullable();
      b.string("price").nullable();
      b.bigInteger("big").nullable();
      b.date("on_date").nullable();
      b.boolean("flag").nullable();
      b.timestamps();
    });
  });
  afterAll(async () => {
    await schemaFor(c).dropIfExists("ce_rows");
  });

  test("a plain string in a json column survives a round trip", async () => {
    const row = await CeRow.create({ data: "just text" });
    expect((await CeRow.find(row.id))!.data).toBe("just text");
  });

  test("json scalars and nested values keep their type", async () => {
    for (const value of [0, false, "0", [], {}, { a: [1, { b: null }] }]) {
      const row = await CeRow.create({ data: value });
      expect((await CeRow.find(row.id))!.data).toEqual(value);
    }
  });

  test("bigint reads back as a bigint", async () => {
    const row = await CeRow.create({ big: 123456789012n });
    expect((await CeRow.find(row.id))!.big).toBe(123456789012n);
  });

  // SQLite hands integers above 2^53 back as JS numbers, so exactness there is limited to that range.
  test.skipIf(driver.name === "sqlite")("bigint beyond 2^53 keeps every digit", async () => {
    const row = await CeRow.create({ big: 9007199254740993n });
    expect((await CeRow.find(row.id))!.big).toBe(9007199254740993n);
  });

  test("decimal:2 stores the rounded value", async () => {
    const row = await CeRow.create({ price: 1.005 });
    expect((await CeRow.find(row.id))!.price).toBe("1.01");
  });

  test("saving an invalid date throws and writes nothing", async () => {
    const before = await CeRow.count();
    await expect((async () => CeRow.create({ on_date: "garbage" }))()).rejects.toThrow(/not a valid date/);
    expect(await CeRow.count()).toBe(before);
  });

  test("null stays null for every cast on write", async () => {
    const row = await CeRow.create({ data: null, price: null, big: null, on_date: null, flag: null });
    const found = (await CeRow.find(row.id))!;
    expect([found.data, found.price, found.big, found.on_date, found.flag]).toEqual([null, null, null, null, null]);
  });
});
