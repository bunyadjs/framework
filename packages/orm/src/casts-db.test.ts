import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Crypt } from "@bunyad/common";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();
Crypt.setKey(`base64:${Buffer.alloc(32, 7).toString("base64")}`);

enum Status { Draft = "draft", Live = "live" }

class CastRow extends Model {
  static table = "cast_rows";
  static fillable = ["flag", "count", "ratio", "label", "meta", "tags", "bag", "born", "seen_at", "status", "secret", "pw", "big", "nothing"];
  static casts() {
    return {
      flag: "boolean" as const,
      count: "integer" as const,
      ratio: "float" as const,
      label: "string" as const,
      meta: "json" as const,
      tags: "array" as const,
      bag: "collection" as const,
      born: "date" as const,
      seen_at: "datetime" as const,
      status: { enum: Status } as never,
      secret: "encrypted" as const,
      pw: "hashed" as const,
      nothing: "json" as const,
    };
  }
  declare id: number;
  declare flag: boolean;
  declare count: number;
  declare ratio: number;
  declare label: string;
  declare meta: Record<string, unknown> | null;
  declare tags: unknown[];
  declare bag: { all(): unknown[] };
  declare born: Date;
  declare seen_at: Date;
  declare secret: string;
  declare pw: string;
  declare nothing: unknown;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "casts round-trip through a real database (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("cast_rows");
      await schema.create("cast_rows", (b) => {
        b.id();
        b.boolean("flag").nullable();
        b.integer("count").nullable();
        b.double("ratio").nullable();
        b.string("label").nullable();
        b.text("meta").nullable();
        b.text("tags").nullable();
        b.text("bag").nullable();
        b.date("born").nullable();
        b.timestamp("seen_at").nullable();
        b.string("status").nullable();
        b.text("secret").nullable();
        b.string("pw").nullable();
        b.text("nothing").nullable();
        b.timestamps();
      });
    });
    afterAll(async () => { await schemaFor(c).dropIfExists("cast_rows"); });

    const raw = async (id: number) => (await c.all<Record<string, unknown>>("SELECT * FROM cast_rows WHERE id = ?", [id]))[0]!;

    test("every scalar and structured cast reads back with the right JS type", async () => {
      const made = (await CastRow.create({
        flag: true, count: 42, ratio: 1.5, label: "hello",
        meta: { a: 1, nested: { b: [1, 2] } }, tags: ["x", "y"], bag: [1, 2, 3],
        born: new Date("2024-03-05T00:00:00Z"), seen_at: new Date("2024-03-05T10:20:30Z"),
      })) as CastRow;
      const row = (await CastRow.find(made.id)) as CastRow;
      expect(row.flag).toBe(true);
      expect(row.count).toBe(42);
      expect(row.ratio).toBe(1.5);
      expect(row.label).toBe("hello");
      expect(row.meta).toEqual({ a: 1, nested: { b: [1, 2] } });
      expect(row.tags).toEqual(["x", "y"]);
      expect(row.bag.all()).toEqual([1, 2, 3]);
      expect(row.born).toBeInstanceOf(Date);
      expect(row.born.toISOString().slice(0, 10)).toBe("2024-03-05");
      expect(row.seen_at).toBeInstanceOf(Date);
      expect(row.seen_at.toISOString().slice(0, 19)).toBe("2024-03-05T10:20:30");
    });

    test("false / zero / empty values are not confused with null", async () => {
      const made = (await CastRow.create({ flag: false, count: 0, ratio: 0, label: "", tags: [], meta: {} })) as CastRow;
      const row = (await CastRow.find(made.id)) as CastRow;
      expect(row.flag).toBe(false);
      expect(row.count).toBe(0);
      expect(row.ratio).toBe(0);
      expect(row.label).toBe("");
      expect(row.tags).toEqual([]);
      expect(row.meta).toEqual({});
    });

    test("null stays null for every cast", async () => {
      const made = (await CastRow.create({ label: "only label" })) as CastRow;
      const row = (await CastRow.find(made.id)) as CastRow;
      expect(row.flag ?? null).toBeNull();
      expect(row.meta ?? null).toBeNull();
      expect(row.born ?? null).toBeNull();
      expect(row.secret ?? null).toBeNull();
    });

    test("encrypted values are ciphertext in the database and plaintext in the model", async () => {
      const made = (await CastRow.create({ label: "enc", secret: "top secret" })) as CastRow;
      expect(String((await raw(made.id)).secret)).not.toContain("top secret");
      expect(((await CastRow.find(made.id)) as CastRow).secret).toBe("top secret");
    });

    test("hashed values are hashed once and never re-hashed on later saves", async () => {
      const made = (await CastRow.create({ label: "hash", pw: "hunter2" })) as CastRow;
      const stored = String((await raw(made.id)).pw);
      expect(stored).not.toBe("hunter2");
      expect(stored.length).toBeGreaterThan(20);
      const row = (await CastRow.find(made.id)) as CastRow;
      row.label = "hash2";
      await row.save();
      expect(String((await raw(made.id)).pw)).toBe(stored);
    });

    test("updating a cast attribute persists and re-reads correctly", async () => {
      const made = (await CastRow.create({ label: "upd", flag: false, meta: { v: 1 }, tags: ["a"] })) as CastRow;
      const row = (await CastRow.find(made.id)) as CastRow;
      row.flag = true;
      row.meta = { v: 2 };
      row.tags = ["a", "b"];
      await row.save();
      const again = (await CastRow.find(made.id)) as CastRow;
      expect([again.flag, again.meta, again.tags]).toEqual([true, { v: 2 }, ["a", "b"]]);
    });

    test("unchanged cast attributes do not make the model dirty after a reload", async () => {
      const made = (await CastRow.create({ label: "dirty", flag: true, meta: { v: 1 }, born: new Date("2024-01-02T00:00:00Z") })) as CastRow;
      const row = (await CastRow.find(made.id)) as CastRow;
      expect(row.isDirty()).toBe(false);
      row.label = "dirty2";
      expect(Object.keys(row.getDirty())).toEqual(["label"]);
    });

    test("where() compares cast values against the stored form", async () => {
      await CastRow.create({ label: "w1", flag: true });
      await CastRow.create({ label: "w2", flag: false });
      expect((await CastRow.where("flag", true).whereIn("label", ["w1", "w2"]).get()).pluck("label").all()).toEqual(["w1"]);
    });

    test("toJSON serializes casts (dates as ISO strings, hashed/hidden handled)", async () => {
      const made = (await CastRow.create({ label: "json", flag: true, born: new Date("2024-03-05T00:00:00Z") })) as CastRow;
      const json = ((await CastRow.find(made.id)) as CastRow).toJSON() as Record<string, unknown>;
      expect(json.flag).toBe(true);
      expect(typeof json.born === "string" || json.born instanceof Date).toBe(true);
    });
  },
);

class ParamCasts extends Model {
  static table = "cast_param_rows";
  static fillable = ["price", "born", "seen_at", "blob", "iborn"];
  static casts() {
    return {
      price: "decimal:2" as const,
      born: "date:Y-m-d" as const,
      seen_at: "datetime:d/m/Y H:i" as const,
      blob: "object" as const,
      iborn: "immutable_date" as const,
    };
  }
  declare id: number;
  declare price: string;
  declare born: Date;
  declare seen_at: Date;
  declare blob: Record<string, unknown>;
  declare iborn: Date;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "Laravel parameterized casts (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("cast_param_rows");
      await schema.create("cast_param_rows", (b) => {
        b.id(); b.string("price").nullable(); b.date("born").nullable(); b.timestamp("seen_at").nullable();
        b.text("blob").nullable(); b.date("iborn").nullable(); b.timestamps();
      });
    });
    afterAll(async () => { await schemaFor(c).dropIfExists("cast_param_rows"); });

    test("decimal:2 reads as an exact fixed-digit string and writes the same", async () => {
      const made = (await ParamCasts.create({ price: 12.5 })) as ParamCasts;
      const row = (await ParamCasts.find(made.id)) as ParamCasts;
      expect(row.price).toBe("12.50");
      row.price = "7" as never;
      await row.save();
      expect(((await ParamCasts.find(made.id)) as ParamCasts).price).toBe("7.00");
      const stored = (await c.all<{ price: unknown }>("SELECT price FROM cast_param_rows WHERE id = ?", [made.id]))[0]!.price;
      expect(String(stored)).toBe("7.00");
    });

    test("date:FORMAT and datetime:FORMAT read as Date and serialize with the format", async () => {
      const made = (await ParamCasts.create({
        born: new Date("2024-03-05T00:00:00Z"),
        seen_at: new Date("2024-03-05T14:07:09Z"),
        iborn: new Date("2023-12-31T00:00:00Z"),
      })) as ParamCasts;
      const row = (await ParamCasts.find(made.id)) as ParamCasts;
      expect(row.born).toBeInstanceOf(Date);
      expect(row.iborn).toBeInstanceOf(Date);
      const json = row.toJSON() as Record<string, unknown>;
      expect(json.born).toBe("2024-03-05");
      expect(json.seen_at).toBe("05/03/2024 14:07");
      expect(String(json.iborn)).toContain("2023-12-31"); // immutable_date has no format → ISO
    });

    test("object cast parses JSON into a plain object", async () => {
      const made = (await ParamCasts.create({ blob: { a: 1, b: [true] } })) as ParamCasts;
      expect(((await ParamCasts.find(made.id)) as ParamCasts).blob).toEqual({ a: 1, b: [true] });
    });

    test("an unknown cast name fails loudly instead of being silently ignored", () => {
      class Bad extends Model {
        static table = "bad";
        static casts() { return { x: "decimall:2" as never }; }
      }
      expect(() => Bad.getCasts()).toThrow(/Unknown cast type "decimall:2" for Bad\.x/);
    });
  },
);

