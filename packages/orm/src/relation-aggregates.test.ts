import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "constrained relation aggregates (%s)",
  (_name, driver) => {
    class Customer extends Model {
      static table = "ra_customers";
      static fillable = ["name"];
      declare id: number;
      declare name: string;
      payments() {
        return this.hasMany(Payment, "customer_id");
      }
      tags() {
        return this.belongsToMany(Tag, "ra_customer_tag", "customer_id", "tag_id");
      }
    }
    class Payment extends Model {
      static table = "ra_payments";
      static fillable = ["customer_id", "status", "amount"];
    }
    class Tag extends Model {
      static table = "ra_tags";
      static fillable = ["name", "weight"];
    }
    const tables = ["ra_customer_tag", "ra_payments", "ra_tags", "ra_customers"];
    const num = (v: unknown) => Number(v);

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("ra_customers", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("ra_payments", (b) => {
        b.id();
        b.integer("customer_id");
        b.string("status");
        b.integer("amount");
        b.timestamps();
      });
      await schema.create("ra_tags", (b) => { b.id(); b.string("name"); b.integer("weight"); b.timestamps(); });
      await schema.create("ra_customer_tag", (b) => { b.integer("customer_id"); b.integer("tag_id"); });

      const ada = await Customer.create({ name: "Ada" });
      const bob = await Customer.create({ name: "Bob" });
      await Customer.create({ name: "Cy" });
      for (const [c, status, amount] of [
        [ada, "paid", 100],
        [ada, "paid", 50],
        [ada, "pending", 25],
        [bob, "pending", 10],
      ] as const) {
        await Payment.create({ customer_id: c.id, status, amount });
      }
      const t1 = await Tag.create({ name: "vip", weight: 5 });
      const t2 = await Tag.create({ name: "new", weight: 1 });
      await ada.tags().attach([t1.id as number, t2.id as number]);
      await bob.tags().attach([t2.id as number]);
    });

    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    const byName = (rows: { all(): unknown[] }) =>
      Object.fromEntries(
        (rows.all() as Array<Record<string, unknown>>).map((r) => [r.name, r]),
      );

    test("withCount with alias and constraint closure", async () => {
      const rows = byName(
        await Customer.withCount({
          "payments as paid_count": (q) => q.where("status", "paid"),
          payments: true,
        }).get(),
      );
      expect(num(rows.Ada!.paid_count)).toBe(2);
      expect(num(rows.Ada!.payments_count)).toBe(3);
      expect(num(rows.Bob!.paid_count)).toBe(0);
      expect(num(rows.Cy!.paid_count)).toBe(0);
    });

    test("withSum / withAvg / withMin / withMax with constraint", async () => {
      const rows = byName(
        await Customer.withSum({ "payments as paid_total": (q) => q.where("status", "paid") }, "amount")
          .withAvg({ "payments as paid_avg": (q) => q.where("status", "paid") }, "amount")
          .withMin({ "payments as paid_min": (q) => q.where("status", "paid") }, "amount")
          .withMax({ "payments as paid_max": (q) => q.where("status", "paid") }, "amount")
          .get(),
      );
      expect(num(rows.Ada!.paid_total)).toBe(150);
      expect(num(rows.Ada!.paid_avg)).toBe(75);
      expect(num(rows.Ada!.paid_min)).toBe(50);
      expect(num(rows.Ada!.paid_max)).toBe(100);
      expect(rows.Bob!.paid_total).toBeNull();
    });

    test("unconstrained aggregates still work with default aliases", async () => {
      const rows = byName(await Customer.withSum("payments", "amount").withCount("payments").get());
      expect(num(rows.Ada!.payments_sum_amount)).toBe(175);
      expect(num(rows.Ada!.payments_count)).toBe(3);
    });

    test("withExists with constraint", async () => {
      const rows = byName(
        await Customer.withExists({ "payments as has_paid": (q) => q.where("status", "paid") }).get(),
      );
      expect(num(rows.Ada!.has_paid)).toBe(1);
      expect(rows.Bob!.has_paid == null || num(rows.Bob!.has_paid) === 0).toBe(true);
    });

    test("belongsToMany constrained count and sum", async () => {
      const rows = byName(
        await Customer.withCount({ "tags as heavy": (q) => q.where("weight", ">", 2) })
          .withSum("tags as weight_total", "weight")
          .get(),
      );
      expect(num(rows.Ada!.heavy)).toBe(1);
      expect(num(rows.Bob!.heavy)).toBe(0);
      expect(num(rows.Ada!.weight_total)).toBe(6);
    });

    test("constraint bindings stay in order with outer where and orderBy", async () => {
      const rows = await Customer.where("name", "!=", "Cy")
        .withCount({ "payments as big": (q) => q.where("amount", ">", 20).where("status", "!=", "void") })
        .orderBy("name")
        .get();
      expect(rows.all().map((r) => [(r as Customer).name, num((r as unknown as Record<string, unknown>).big)])).toEqual([
        ["Ada", 3],
        ["Bob", 0],
      ]);
    });

    test("filter on a constrained aggregate via having-style where", async () => {
      const rows = await Customer.withCount({ "payments as paid": (q) => q.where("status", "paid") })
        .get();
      expect(rows.all().filter((r) => num((r as unknown as Record<string, unknown>).paid) > 0)).toHaveLength(1);
    });
  },
);
