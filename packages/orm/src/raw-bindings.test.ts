/**
 * Raw SQL with bound values: every raw method accepts bindings, and the bindings stay in step with
 * the placeholders wherever the clause lands in the statement.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { listen, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class RbOwner extends Model {
  static table = "rb_owners";
  static fillable = ["name"];
  declare id: number;
  items() {
    return this.hasMany(RbItem, "owner_id");
  }
}

class RbItem extends Model {
  static table = "rb_items";
  static fillable = ["owner_id", "name", "sku", "qty"];
  declare id: number;
  declare name: string;
  declare sku: string;
  declare qty: number;
}

const ids = (rows: { all(): unknown[] }): number[] => rows.all().map((row) => Number((row as { id: number }).id));
const names = (rows: { all(): unknown[] }): string[] => rows.all().map((row) => String((row as { name: string }).name));

describe.each(drivers.map((d) => [d.name, d] as const))("raw SQL with bindings (%s)", (_name, driver) => {
  const c = driver.connection;
  const isPostgres = driver.name === "postgres";

  beforeAll(async () => {
    Model.setConnection(c);
    const schema = schemaFor(c);
    for (const table of ["rb_tags", "rb_items", "rb_owners"]) await schema.dropIfExists(table);
    await schema.create("rb_owners", (b) => {
      b.id();
      b.string("name");
      b.timestamps();
    });
    await schema.create("rb_items", (b) => {
      b.id();
      b.integer("owner_id").nullable();
      b.string("name");
      b.string("sku");
      b.integer("qty");
      b.timestamps();
    });
    await schema.create("rb_tags", (b) => {
      b.id();
      b.integer("item_id");
      b.string("label");
    });
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    await c.run(`INSERT INTO rb_owners (name, created_at, updated_at) VALUES (?, ?, ?), (?, ?, ?)`, ["A", ts, ts, "B", ts, ts]);
    const rows: Array<[number, string, string, number]> = [
      [1, "Alpha", "SKU_001", 5],
      [1, "Beta", "SKUX001", 10],
      [2, "Gamma", "SALE-50%", 15],
      [2, "Delta", "SALE-500", 20],
      [2, "O'Brien", "BS\\1", 25],
    ];
    for (const [owner, name, sku, qty] of rows) {
      await c.run(`INSERT INTO rb_items (owner_id, name, sku, qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [
        owner,
        name,
        sku,
        qty,
        ts,
        ts,
      ]);
    }
    await c.run(`INSERT INTO rb_tags (item_id, label) VALUES (?, ?), (?, ?), (?, ?)`, [3, "hot", 4, "hot", 1, "cold"]);
  });

  afterAll(async () => {
    const schema = schemaFor(c);
    for (const table of ["rb_tags", "rb_items", "rb_owners"]) await schema.dropIfExists(table);
  });

  describe("orderByRaw and orderBySql", () => {
    test("bindings are bound", async () => {
      const rows = await RbItem.newQuery().orderByRaw("CASE WHEN qty > ? THEN 0 ELSE 1 END, id", [12]).get();
      expect(ids(rows)).toEqual([3, 4, 5, 1, 2]);
      const alias = await RbItem.newQuery().orderBySql("CASE WHEN qty > ? THEN 1 ELSE 0 END, id", [12]).get();
      expect(ids(alias)).toEqual([1, 2, 3, 4, 5]);
    });

    test("a different binding gives a different order (the compiled SQL is shared, the values are not)", async () => {
      const order = (threshold: number) =>
        RbItem.newQuery().orderByRaw("CASE WHEN qty > ? THEN 0 ELSE 1 END, id", [threshold]).get();
      expect(ids(await order(12))).toEqual([3, 4, 5, 1, 2]);
      expect(ids(await order(7))).toEqual([2, 3, 4, 5, 1]);
      expect(ids(await order(22))).toEqual([5, 1, 2, 3, 4]);
    });

    test("bindings follow the clauses in statement order: select, where, group, having, order", async () => {
      const rows = await RbItem.newQuery()
        .selectRaw("id, qty + ? AS shifted", [100])
        .whereRaw("qty >= ?", [10])
        .orderByRaw("ABS(qty - ?), id", [16])
        .limit(2)
        .get();
      expect(ids(rows)).toEqual([3, 4]);
      expect(rows.all().map((row) => Number((row as unknown as { shifted: number }).shifted))).toEqual([115, 120]);
    });

    test("with a relation filter, whose query takes a different path", async () => {
      const rows = await RbOwner.whereHas("items", (q) => q.where("qty", ">", 12))
        .orderByRaw("CASE WHEN name = ? THEN 0 ELSE 1 END, id", ["B"])
        .get();
      expect(names(rows)).toEqual(["B"]);
      const both = await RbOwner.whereHas("items", (q) => q.where("qty", ">", 1))
        .orderByRaw("CASE WHEN name = ? THEN 0 ELSE 1 END, id", ["B"])
        .get();
      expect(names(both)).toEqual(["B", "A"]);
    });

    test("the SQL text never contains the bound value", async () => {
      const seen: string[] = [];
      const off = listen((e) => {
        if (/rb_items/.test(e.sql)) seen.push(e.sql);
      });
      try {
        await RbItem.newQuery().orderByRaw("CASE WHEN name = ? THEN 0 ELSE 1 END", ["x'; DROP TABLE rb_items; --"]).get();
      } finally {
        off();
      }
      expect(seen.join("\n")).not.toContain("DROP TABLE");
      expect(ids(await RbItem.newQuery().get())).toHaveLength(5);
    });
  });

  describe("groupByRaw", () => {
    // Placeholders in a GROUP BY expression are not matched against the SELECT list, so the
    // expression is only grouped on, not selected.
    test("bindings are bound (they used to be dropped)", async () => {
      const rows = await RbItem.newQuery()
        .selectRaw("COUNT(*) AS n")
        .groupByRaw("(qty > ?)", [12])
        .orderByRaw("n")
        .get();
      expect(rows.all().map((row) => Number((row as unknown as { n: number }).n))).toEqual([2, 3]);
    });

    test("bindings keep their place between where and having", async () => {
      const rows = await RbItem.newQuery()
        .selectRaw("COUNT(*) AS n")
        .whereRaw("qty >= ?", [5])
        .groupByRaw("(qty > ?)", [12])
        .havingRaw("COUNT(*) >= ?", [3])
        .orderByRaw("n")
        .get();
      expect(rows.all().map((row) => Number((row as unknown as { n: number }).n))).toEqual([3]);
    });
  });
});
