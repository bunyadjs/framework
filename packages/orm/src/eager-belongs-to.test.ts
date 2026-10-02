import { expect, test } from "bun:test";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";

/**
 * P0: BelongsTo eager must use a single IN (...) for PAGE-sized loads
 * (not N× Related.find).
 */
test("BelongsTo eager uses one IN query for PAGE=50 loads", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("brands", (t) => {
    t.id();
    t.string("name");
  });
  await schema.create("products", (t) => {
    t.id();
    t.string("name");
    t.integer("brand_id");
  });

  class Brand extends Model {
    static table = "brands";
    static timestamps = false;
    static fillable = ["name"];
  }
  class Product extends Model {
    static table = "products";
    static timestamps = false;
    static fillable = ["name", "brand_id"];
    brand() {
      return this.belongsTo(Brand, "brand_id");
    }
  }

  for (let i = 1; i <= 10; i++) {
    await Brand.create({ name: `Brand-${i}` });
  }
  for (let i = 1; i <= 50; i++) {
    await Product.create({
      name: `Product-${i}`,
      brand_id: ((i - 1) % 10) + 1,
    });
  }

  const sqlLog: string[] = [];
  const origAllSync = connection.allSync?.bind(connection);
  const origAll = connection.all.bind(connection);
  if (connection.allSync) {
    connection.allSync = ((sql: string, params?: unknown[]) => {
      sqlLog.push(sql);
      return origAllSync!(sql, params);
    }) as typeof connection.allSync;
  }
  connection.all = (async (sql: string, params?: unknown[]) => {
    sqlLog.push(sql);
    return origAll(sql, params);
  }) as typeof connection.all;

  const page = await Product.with("brand").limit(50).get();
  expect(page.count()).toBe(50);
  const first = page.all()[0] as Product & { brand: Brand };
  expect(first.brand.name).toMatch(/^Brand-/);

  const brandIns = sqlLog.filter(
    (sql) => /FROM\s+"?brands"?/i.test(sql) && /\bIN\s*\(/i.test(sql),
  );
  expect(brandIns.length).toBe(1);

  // No per-row primary-key lookups for brands (the old sync-find path).
  const brandFinds = sqlLog.filter(
    (sql) =>
      /FROM\s+"?brands"?/i.test(sql) &&
      /WHERE.*"?(?:brands\.)?id"?\s*=\s*\?/i.test(sql) &&
      !/\bIN\s*\(/i.test(sql),
  );
  expect(brandFinds.length).toBe(0);
});
