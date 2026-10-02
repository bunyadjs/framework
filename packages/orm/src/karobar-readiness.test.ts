/**
 * Karobar readiness suite — existence + behavior for ORM APIs
 * we need before wiring Bunyad into Nest (see docs/KAROBAR_STRANGLER_MIGRATION_PLAN.md).
 */
import { expect, test } from "bun:test";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model, OrmCollection } from "../src/index.ts";

async function productCatalogSchema() {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("brands", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("categories", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("products", (table) => {
    table.id();
    table.string("name");
    table.integer("brand_id").nullable();
    table.integer("category_id").nullable();
    table.integer("price").default(0);
    table.timestamps();
  });
  await schema.create("product_tag", (table) => {
    table.integer("product_id");
    table.integer("tag_id");
  });
  await schema.create("tags", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });

  class Brand extends Model {
    static table = "brands";
    static fillable = ["name"];
    products() {
      return this.hasMany(Product, "brand_id");
    }
  }
  class Category extends Model {
    static table = "categories";
    static fillable = ["name"];
  }
  class Tag extends Model {
    static table = "tags";
    static fillable = ["name"];
  }
  class Product extends Model {
    static table = "products";
    static fillable = ["name", "brand_id", "category_id", "price"];
    declare name: string;
    brand() {
      return this.belongsTo(Brand, "brand_id");
    }
    category() {
      return this.belongsTo(Category, "category_id");
    }
    tags() {
      return this.belongsToMany(Tag, "product_tag", "product_id", "tag_id");
    }
  }

  return { connection, Brand, Category, Tag, Product };
}

test("Gate A: whereRelation / whereHas / with / join / withCount exist", () => {
  expect(typeof Model.whereRelation).toBe("function");
  expect(typeof Model.orWhereRelation).toBe("function");
  expect(typeof Model.whereHas).toBe("function");
  expect(typeof Model.with).toBe("function");
  expect(typeof Model.withCount).toBe("function");
  const q = Model.newQuery();
  expect(typeof q.whereRelation).toBe("function");
  expect(typeof q.orWhereRelation).toBe("function");
  expect(typeof q.join).toBe("function");
  expect(typeof q.leftJoin).toBe("function");
  expect(typeof q.rightJoin).toBe("function");
});

test("get() returns OrmCollection", async () => {
  const { connection, Brand, Product } = await productCatalogSchema();
  await Brand.create({ name: "Acme" });
  const brand = await Brand.where("name", "Acme").first();
  await Product.create({ name: "Widget", brand_id: brand!.id, price: 10 });

  const all = await Product.all();
  expect(all).toBeInstanceOf(OrmCollection);
  expect(all.count()).toBe(1);
  expect(all.pluck("name").all()).toEqual(["Widget"]);

  const filtered = await Product.whereRelation("brand", "name", "Acme").get();
  expect(filtered).toBeInstanceOf(OrmCollection);
  expect(filtered.count()).toBe(1);

  await connection.close();
});

test("whereRelation on belongsTo (Product → Brand)", async () => {
  const { connection, Brand, Product } = await productCatalogSchema();
  const acme = await Brand.create({ name: "Acme" });
  const other = await Brand.create({ name: "Other" });
  await Product.create({ name: "A", brand_id: acme.id, price: 1 });
  await Product.create({ name: "B", brand_id: other.id, price: 2 });
  await Product.create({ name: "C", brand_id: acme.id, price: 3 });

  const byName = await Product.whereRelation("brand", "name", "Acme").get();
  expect(byName.pluck("name").sort().all()).toEqual(["A", "C"]);

  const byOp = await Product.whereRelation("brand", "id", ">", 0)
    .orderBy("name")
    .get();
  expect(byOp.count()).toBe(3);

  const viaHas = await Product.whereHas("brand", (q) => {
    q.where("name", "Other");
  }).get();
  expect(viaHas.pluck("name").all()).toEqual(["B"]);

  // Count/paginate must keep BelongsTo whereHas joins (qualified related wheres).
  const page = await Product.whereHas("brand", (q) => {
    q.where("name", "Acme");
  }).paginate(10, 1);
  expect(page.total).toBe(2);
  expect(page.items.map((row) => row.name).sort()).toEqual(["A", "C"]);

  // Nested where(callback) + BelongsTo whereHas must use IN, not JOIN
  // (nested builders only emit WHERE — avoids missing FROM-clause).
  const nested = await Product.where((inner) => {
    inner
      .where("name", "B")
      .orWhereHas("brand", (bq) => {
        bq.where("name", "Acme");
      });
  })
    .orderBy("name")
    .get();
  expect(nested.pluck("name").all()).toEqual(["A", "B", "C"]);

  const nestedPage = await Product.where((inner) => {
    inner.whereHas("brand", (bq) => {
      bq.where("name", "Other");
    });
  }).paginate(10, 1);
  expect(nestedPage.total).toBe(1);
  expect(nestedPage.items.map((row) => row.name)).toEqual(["B"]);

  await connection.close();
});

test("whereHas hasMany + withCount + eager with", async () => {
  const { connection, Brand, Product } = await productCatalogSchema();
  const acme = await Brand.create({ name: "Acme" });
  const empty = await Brand.create({ name: "Empty" });
  await Product.create({ name: "A", brand_id: acme.id, price: 1 });
  await Product.create({ name: "B", brand_id: acme.id, price: 2 });

  const withProducts = await Brand.whereHas("products").get();
  expect(withProducts.pluck("name").all()).toEqual(["Acme"]);
  expect(withProducts).toBeInstanceOf(OrmCollection);

  const doesnt = await Brand.whereDoesntHave("products").get();
  expect(doesnt.pluck("name").all()).toEqual(["Empty"]);

  const counted = await Brand.withCount("products").orderBy("name").get();
  expect(Number((counted.first() as unknown as Record<string, unknown>).products_count)).toBe(2);
  expect(
    Number((counted.last() as unknown as Record<string, unknown>).products_count),
  ).toBe(0);

  const eager = await Product.with("brand").where("name", "A").first();
  expect((eager as unknown as { brand: { name: string } }).brand.name).toBe(
    "Acme",
  );
  expect(empty.id).toBeTruthy();

  await connection.close();
});

test("join brands keeps OrmCollection of Product", async () => {
  const { connection, Brand, Product } = await productCatalogSchema();
  const acme = await Brand.create({ name: "Acme" });
  await Product.create({ name: "Widget", brand_id: acme.id, price: 5 });

  const joined = await Product.join(
    "brands",
    "products.brand_id",
    "=",
    "brands.id",
  )
    .where("brands.name", "Acme")
    .get();

  expect(joined).toBeInstanceOf(OrmCollection);
  expect(joined.count()).toBe(1);
  expect(joined.first()).toBeInstanceOf(Product);
  expect(joined.first()!.name).toBe("Widget");

  await connection.close();
});

test("belongsToMany whereHas + attach", async () => {
  const { connection, Product, Tag } = await productCatalogSchema();
  const p = await Product.create({ name: "Tagged", price: 1 });
  const t = await Tag.create({ name: "sale" });
  await p.tags().attach([t.id!]);

  const found = await Product.whereRelation("tags", "name", "sale").get();
  expect(found.count()).toBe(1);
  expect(found).toBeInstanceOf(OrmCollection);

  await connection.close();
});

test("whereHas belongsTo paginate qualifies shared tenant_id with joins", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("brands", (table) => {
    table.id();
    table.string("name");
    table.string("tenant_id");
  });
  await schema.create("products", (table) => {
    table.id();
    table.string("name");
    table.integer("brand_id").nullable();
    table.string("tenant_id");
  });

  class Brand extends Model {
    static table = "brands";
    static timestamps = false;
    static fillable = ["name", "tenant_id"];
  }
  class Product extends Model {
    static table = "products";
    static timestamps = false;
    static fillable = ["name", "brand_id", "tenant_id"];
    declare name: string;
    brand() {
      return this.belongsTo(Brand, "brand_id");
    }
  }
  Product.addGlobalScope("tenant", (query) => {
    query.where("tenant_id", "t1");
  });

  const brand = await Brand.create({ name: "Acme", tenant_id: "t1" });
  await Product.create({ name: "A", brand_id: brand.id, tenant_id: "t1" });
  await Product.create({ name: "B", brand_id: brand.id, tenant_id: "t2" });

  const page = await Product.whereHas("brand", (q) => {
    q.where("name", "Acme");
  }).paginate(10, 1);

  expect(page.total).toBe(1);
  expect(page.items.map((row) => row.name)).toEqual(["A"]);

  await connection.close();
});

test("whereHas two belongsTo on the same table uses distinct join aliases", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("accounts", (table) => {
    table.id();
    table.string("type");
    table.string("category");
  });
  await schema.create("transactions", (table) => {
    table.id();
    table.string("status");
    table.integer("debit_account_id").nullable();
    table.integer("credit_account_id").nullable();
  });

  class Account extends Model {
    static table = "accounts";
    static timestamps = false;
    static fillable = ["type", "category"];
  }
  class Txn extends Model {
    static table = "transactions";
    static timestamps = false;
    static fillable = ["status", "debit_account_id", "credit_account_id"];
    debitAccount() {
      return this.belongsTo(Account, "debit_account_id");
    }
    creditAccount() {
      return this.belongsTo(Account, "credit_account_id");
    }
  }

  const equity = await Account.create({ type: "equity", category: "capital" });
  const cash = await Account.create({ type: "asset", category: "cash" });
  await Txn.create({
    status: "completed",
    credit_account_id: equity.id,
    debit_account_id: cash.id,
  });
  await Txn.create({
    status: "completed",
    credit_account_id: cash.id,
    debit_account_id: equity.id,
  });

  const count = await Txn.where("status", "completed")
    .whereHas("creditAccount", (q) => {
      q.where("type", "equity").where("category", "capital");
    })
    .whereHas("debitAccount", (q) => {
      q.where("category", "cash");
    })
    .count();

  expect(count).toBe(1);

  const rows = await Txn.where("status", "completed")
    .whereHas("creditAccount", (q) => {
      q.where("type", "equity").where("category", "capital");
    })
    .whereHas("debitAccount", (q) => {
      q.where("category", "cash");
    })
    .get();
  expect(rows.count()).toBe(1);

  await connection.close();
});
