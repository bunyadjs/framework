/**
 * Raw SQL with bound values: every raw method accepts bindings (or a `sql` fragment), the bindings
 * stay in step with the placeholders wherever the clause lands in the statement, and the LIKE
 * helpers match text literally.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { listen, schemaFor, sql } from "@bunyad/database";
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

    test("a sql fragment is accepted", async () => {
      const rows = await RbItem.newQuery()
        .orderByRaw(sql`CASE WHEN qty > ${12} THEN 0 ELSE 1 END, id`)
        .get();
      expect(ids(rows)).toEqual([3, 4, 5, 1, 2]);
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

  describe("joinRaw", () => {
    test("bindings are bound and keep their place before the where bindings", async () => {
      const rows = await RbItem.newQuery()
        .selectRaw("rb_items.id AS id, rb_items.name AS name")
        .joinRaw("INNER JOIN rb_tags t ON t.item_id = rb_items.id AND t.label = ?", ["hot"])
        .whereRaw("rb_items.qty >= ?", [16])
        .orderByRaw("rb_items.id")
        .get();
      expect(ids(rows)).toEqual([4]);
    });
  });

  describe("a sql fragment is accepted by every raw method", () => {
    test("whereRaw, orWhereRaw, selectRaw, havingRaw", async () => {
      const where = await RbItem.newQuery()
        .whereRaw(sql`qty > ${12} AND name <> ${"Delta"}`)
        .orderByRaw("id")
        .get();
      expect(ids(where)).toEqual([3, 5]);

      const either = await RbItem.newQuery()
        .whereRaw(sql`qty > ${22}`)
        .orWhereRaw(sql`name = ${"Alpha"}`)
        .orderByRaw("id")
        .get();
      expect(ids(either)).toEqual([1, 5]);

      const selected = await RbItem.newQuery()
        .selectRaw(sql`id, qty + ${1} AS next`)
        .whereRaw("id = ?", [1])
        .get();
      expect(Number((selected.all()[0] as unknown as { next: number }).next)).toBe(6);

      const having = await RbItem.newQuery()
        .selectRaw("COUNT(*) AS n")
        .groupByRaw(sql`(qty > ${12})`)
        .havingRaw(sql`COUNT(*) >= ${3}`)
        .get();
      expect(having.all()).toHaveLength(1);
    });

    test("fragments nest and keep their bindings in order", () => {
      const inner = sql`b = ${2}`;
      const out = sql`a = ${1} AND ${inner} AND c IN (${sql.list([3, 4])})`;
      expect(out.sql).toBe("a = ? AND b = ? AND c IN (?, ?)");
      expect(out.bindings).toEqual([1, 2, 3, 4]);
      expect(sql.join([sql`x = ${1}`, sql`y = ${2}`], " OR ")).toEqual({ sql: "x = ? OR y = ?", bindings: [1, 2] });
      expect(sql`SELECT ${sql.trusted("name")} FROM t`).toEqual({ sql: "SELECT name FROM t", bindings: [] });
    });
  });

  describe("literal LIKE matching", () => {
    const skus = async (query: { get(): unknown }) =>
      ((await query.get()) as { all(): unknown[] }).all().map((row) => (row as { sku: string }).sku).sort();

    test("whereContains takes `_`, `%` and `\\` as ordinary characters", async () => {
      expect(await skus(RbItem.newQuery().whereContains("sku", "SKU_001"))).toEqual(["SKU_001"]);
      expect(await skus(RbItem.newQuery().whereContains("sku", "SALE-50%"))).toEqual(["SALE-50%"]);
      expect(await skus(RbItem.newQuery().whereContains("sku", "BS\\1"))).toEqual(["BS\\1"]);
      // a bare wildcard character is just a character
      expect(await skus(RbItem.newQuery().whereContains("sku", "%"))).toEqual(["SALE-50%"]);
      expect(await skus(RbItem.newQuery().whereContains("sku", "_"))).toEqual(["SKU_001"]);
    });

    test("whereStartsWith and whereEndsWith", async () => {
      expect(await skus(RbItem.newQuery().whereStartsWith("sku", "SKU_"))).toEqual(["SKU_001"]);
      expect(await skus(RbItem.newQuery().whereStartsWith("sku", "SALE-"))).toEqual(["SALE-500", "SALE-50%"].sort());
      expect(await skus(RbItem.newQuery().whereEndsWith("sku", "0%"))).toEqual(["SALE-50%"]);
      expect(await skus(RbItem.newQuery().whereEndsWith("sku", "001"))).toEqual(["SKUX001", "SKU_001"].sort());
    });

    test("or and not variants", async () => {
      const either = await skus(RbItem.newQuery().whereContains("sku", "SKU_").orWhereContains("sku", "BS\\"));
      expect(either).toEqual(["BS\\1", "SKU_001"].sort());
      const not = await skus(RbItem.newQuery().whereNotContains("sku", "SALE"));
      expect(not).toEqual(["BS\\1", "SKUX001", "SKU_001"].sort());
    });

    test("matching ignores case unless asked", async () => {
      expect(names(await RbItem.newQuery().whereContains("name", "alpha").get())).toEqual(["Alpha"]);
      if (isPostgres) {
        expect(names(await RbItem.newQuery().whereContains("name", "alpha", { caseSensitive: true }).get())).toEqual([]);
        expect(names(await RbItem.newQuery().whereContains("name", "Alpha", { caseSensitive: true }).get())).toEqual(["Alpha"]);
      }
    });

    test("quotes and injection attempts are just text", async () => {
      expect(names(await RbItem.newQuery().whereContains("name", "O'Brien").get())).toEqual(["O'Brien"]);
      for (const hostile of ["'; DROP TABLE rb_items; --", "%' OR '1'='1", "\\", "a".repeat(5000)]) {
        expect(await RbItem.newQuery().whereContains("name", hostile).get()).toBeDefined();
      }
      expect(ids(await RbItem.newQuery().get())).toHaveLength(5);
    });

    test("an empty term matches every row that has a value", async () => {
      expect(ids(await RbItem.newQuery().whereContains("name", "").get())).toHaveLength(5);
    });

    test("sql.contains, sql.startsWith and sql.endsWith give the same matches as fragments", async () => {
      expect(await skus(RbItem.newQuery().whereRaw(sql.contains("sku", "SKU_001")))).toEqual(["SKU_001"]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.contains("sku", "SALE-50%")))).toEqual(["SALE-50%"]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.contains("sku", "BS\\1")))).toEqual(["BS\\1"]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.contains("sku", "!")))).toEqual([]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.startsWith("sku", "SKU_")))).toEqual(["SKU_001"]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.endsWith("sku", "0%")))).toEqual(["SALE-50%"]);
      expect(names(await RbItem.newQuery().whereRaw(sql.contains("name", "ALPHA")).get())).toEqual(["Alpha"]);
      // inside a subquery fragment, next to other bound values
      const exists = sql`EXISTS (SELECT 1 FROM rb_tags t WHERE t.item_id = rb_items.id AND t.label = ${"hot"}) AND ${sql.contains("sku", "SALE")}`;
      expect(await skus(RbItem.newQuery().whereRaw(exists))).toEqual(["SALE-500", "SALE-50%"].sort());
    });

    test("an escape character in the term is itself taken literally", async () => {
      await c.run("INSERT INTO rb_items (owner_id, name, sku, qty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [
        1, "Bang", "A!B", 1, "2026-01-01 00:00:00", "2026-01-01 00:00:00",
      ]);
      expect(await skus(RbItem.newQuery().whereRaw(sql.contains("sku", "A!B")))).toEqual(["A!B"]);
      expect(await skus(RbItem.newQuery().whereContains("sku", "A!B"))).toEqual(["A!B"]);
      await c.run("DELETE FROM rb_items WHERE sku = ?", ["A!B"]);
    });

    test("the term is bound, not written into the statement", async () => {
      const seen: string[] = [];
      const off = listen((e) => {
        if (/rb_items/.test(e.sql)) seen.push(e.sql);
      });
      try {
        await RbItem.newQuery().whereContains("name", "needle-xyz").get();
      } finally {
        off();
      }
      expect(seen.join("\n")).not.toContain("needle-xyz");
    });
  });
});
