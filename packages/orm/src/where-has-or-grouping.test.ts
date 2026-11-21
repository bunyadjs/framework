import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

/**
 * A relation callback that uses `or` must stay grouped:
 * `fk = pk AND (a OR b) AND <scopes>`. Without the group, `fk = pk AND a OR b`
 * lets `b` match a related row of any parent, so every parent matches.
 */
describe.each(drivers.map((d) => [d.name, d] as const))(
  "whereHas callbacks with or stay grouped (%s)",
  (_name, driver) => {
    class Customer extends Model {
      static table = "wg_customers";
      static timestamps = false;
      static fillable = ["name", "vip"];
      declare id: number;
    }
    class Stock extends Model {
      static table = "wg_stocks";
      static timestamps = false;
      static fillable = ["serial"];
      declare id: number;
    }
    class Line extends Model {
      static table = "wg_lines";
      static timestamps = false;
      static fillable = ["order_id", "stock_id", "name", "active"];
      declare id: number;
      stock() {
        return this.belongsTo(Stock, "stock_id");
      }
    }
    class Order extends Model {
      static table = "wg_orders";
      static timestamps = false;
      static fillable = ["number", "customer_id"];
      declare id: number;
      declare number: string;
      lines() {
        return this.hasMany(Line, "order_id");
      }
      customer() {
        return this.belongsTo(Customer, "customer_id");
      }
    }
    const tables = ["wg_lines", "wg_orders", "wg_stocks", "wg_customers"];

    const numbers = async (query: any) =>
      (await query.get())
        .all()
        .map((row: Order) => row.number)
        .sort();

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("wg_customers", (b) => {
        b.id();
        b.string("name");
        b.integer("vip");
      });
      await schema.create("wg_stocks", (b) => {
        b.id();
        b.string("serial");
      });
      await schema.create("wg_orders", (b) => {
        b.id();
        b.string("number");
        b.integer("customer_id");
      });
      await schema.create("wg_lines", (b) => {
        b.id();
        b.integer("order_id");
        b.integer("stock_id").nullable();
        b.string("name");
        b.integer("active");
      });

      const ann = await Customer.create({ name: "Ann", vip: 0 });
      const bob = await Customer.create({ name: "Bob", vip: 0 });
      const phone = await Stock.create({ serial: "IMEI-1" });
      const a = await Order.create({ number: "A", customer_id: ann.id });
      const b = await Order.create({ number: "B", customer_id: bob.id });
      await Line.create({ order_id: a.id, stock_id: phone.id, name: "Phone", active: 1 });
      await Line.create({ order_id: b.id, stock_id: null, name: "Cable", active: 1 });
      // Inactive line of B: hidden by the global scope below.
      await Line.create({ order_id: b.id, stock_id: null, name: "Phone case", active: 0 });
      Line.addGlobalScope("active", (q) => q.where("active", 1));
    });

    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("flat or inside a hasMany callback matches only that parent", async () => {
      const q = Order.query().whereHas("lines", (lq: any) => {
        lq.where("name", "Phone").orWhere("name", "Laptop");
      });
      expect(q.toSql()).toMatch(/AND \(.*name.* = \? OR .*name.* = \?\)/);
      expect(await numbers(q)).toEqual(["A"]);
    });

    test("or with a nested belongsTo whereHas matches only that parent", async () => {
      const q = Order.query().where((inner: any) => {
        inner.where("number", "none").orWhereHas("lines", (lq: any) => {
          lq.whereLike("name", "%nothing%").orWhereHas("stock", (sq: any) => {
            sq.whereLike("serial", "%IMEI-1%");
          });
        });
      });
      expect(await numbers(q)).toEqual(["A"]);
    });

    test("related global scope still applies to grouped or constraints", async () => {
      const q = Order.query().whereHas("lines", (lq: any) => {
        lq.where("name", "Phone case").orWhere("name", "Laptop");
      });
      expect(await numbers(q)).toEqual([]);
    });

    test("or inside a belongsTo whereHas (join) does not loosen the parent", async () => {
      const q = Order.query()
        .where("number", "B")
        .whereHas("customer", (cq: any) => {
          cq.where("name", "Nobody").orWhere("name", "Ann");
        });
      expect(await numbers(q)).toEqual([]);
    });

    test("plain and callbacks keep their ungrouped SQL", async () => {
      const q = Order.query().whereHas("lines", (lq: any) => {
        lq.where("name", "Phone");
      });
      expect(q.toSql()).not.toMatch(/AND \(/);
      expect(await numbers(q)).toEqual(["A"]);
    });
  },
);
