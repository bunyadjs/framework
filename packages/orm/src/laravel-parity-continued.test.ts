/**
 * Continuations: loadSum/ofMany/chunkById/withCount object form.
 */
import { expect, test } from "bun:test";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";

test("loadSum loadExists ofMany latestOfMany", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("orders", (table) => {
    table.id();
    table.integer("user_id");
    table.integer("total");
  });

  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name"];
    orders() {
      return this.hasMany(Order, "user_id");
    }
    latestOrder() {
      return this.hasOne(Order, "user_id").latestOfMany();
    }
    bestOrder() {
      return this.hasOne(Order, "user_id").ofMany("total", "max");
    }
  }
  class Order extends Model {
    static table = "orders";
    static timestamps = false;
    static fillable = ["user_id", "total"];
    declare total: number;
  }

  const user = await User.create({ name: "Ada" });
  await Order.create({ user_id: user.id, total: 10 });
  await Order.create({ user_id: user.id, total: 50 });
  await Order.create({ user_id: user.id, total: 20 });

  await user.loadSum("orders", "total");
  expect(Number((user as unknown as Record<string, unknown>).orders_sum_total)).toBe(80);

  await user.loadExists("orders");
  expect(Number((user as unknown as Record<string, unknown>).orders_exists)).toBe(1);

  const latest = await user.latestOrder().first();
  expect(Number(latest?.id)).toBe(3);

  const best = await user.bestOrder().first();
  expect(Number(best?.total)).toBe(50);

  const other = await User.create({ name: "Grace" });
  await Order.create({ user_id: other.id, total: 5 });
  await Order.create({ user_id: other.id, total: 99 });

  const eager = await User.with("latestOrder", "bestOrder").orderBy("id").get();
  expect(eager.count()).toBe(2);
  const ada = eager.all()[0] as unknown as {
    latestOrder: { id: number } | null;
    bestOrder: { total: number } | null;
  };
  const grace = eager.all()[1] as unknown as {
    bestOrder: { total: number } | null;
  };
  expect(Number(ada.latestOrder?.id)).toBe(3);
  expect(Number(ada.bestOrder?.total)).toBe(50);
  expect(Number(grace.bestOrder?.total)).toBe(99);

  await connection.close();
});

test("ofMany soft deletes ignore trashed rows in subquery", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("orders", (table) => {
    table.id();
    table.integer("user_id");
    table.integer("total");
    table.text("deleted_at").nullable();
  });

  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name"];
    bestOrder() {
      return this.hasOne(Order, "user_id").ofMany("total", "max");
    }
  }
  class Order extends Model {
    static table = "orders";
    static timestamps = false;
    static softDeletes = true;
    static fillable = ["user_id", "total"];
    declare total: number;
  }

  const user = await User.create({ name: "Ada" });
  await Order.create({ user_id: user.id, total: 10 });
  const high = await Order.create({ user_id: user.id, total: 99 });
  await high.delete();

  const best = await user.bestOrder().first();
  expect(Number(best?.total)).toBe(10);

  const eager = await User.with("bestOrder").where("id", user.id).first();
  expect(
    Number(
      (eager as unknown as { bestOrder: { total: number } | null }).bestOrder
        ?.total,
    ),
  ).toBe(10);

  await connection.close();
});

test("withCount object alias and chunkById lazyById", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("brands", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("products", (table) => {
    table.id();
    table.string("name");
    table.integer("brand_id");
  });

  class Brand extends Model {
    static table = "brands";
    static timestamps = false;
    static fillable = ["name"];
    products() {
      return this.hasMany(Product, "brand_id");
    }
  }
  class Product extends Model {
    static table = "products";
    static timestamps = false;
    static fillable = ["name", "brand_id"];
  }

  const brand = await Brand.create({ name: "Acme" });
  for (let i = 1; i <= 5; i++) {
    await Product.create({ name: `P${i}`, brand_id: brand.id });
  }

  const row = await Brand.withCount({
    products: { as: "productsCount" },
  }).first();
  expect(Number((row as unknown as Record<string, unknown>).productsCount)).toBe(5);

  const ids: number[] = [];
  await Product.newQuery().chunkById(2, (chunk) => {
    for (const m of chunk) ids.push(Number(m.id));
  });
  expect(ids).toEqual([1, 2, 3, 4, 5]);

  const lazyIds: number[] = [];
  for await (const m of Product.newQuery().lazyById(2)) {
    lazyIds.push(Number(m.id));
  }
  expect(lazyIds).toEqual([1, 2, 3, 4, 5]);

  const brandB = await Brand.create({ name: "Beta" });
  await Product.create({ name: "P6", brand_id: brandB.id });
  const brands = await Brand.orderBy("id").get();
  await brands.loadCount("products");
  await brands.loadSum("products", "id");
  expect(
    Number((brands.all()[0] as unknown as Record<string, unknown>).products_count),
  ).toBe(5);
  expect(
    Number((brands.all()[1] as unknown as Record<string, unknown>).products_count),
  ).toBe(1);
  expect(
    Number((brands.all()[0] as unknown as Record<string, unknown>).products_sum_id),
  ).toBe(15);

  await connection.close();
});
