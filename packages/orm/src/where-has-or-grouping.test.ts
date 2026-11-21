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
      static fillable = ["name", "vip", "referrer_id"];
      declare id: number;
      declare name: string;
      referrer() {
        return this.belongsTo(Customer, "referrer_id");
      }
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
        b.integer("referrer_id").nullable();
      });
      await schema.create("wg_stocks", (b) => {
        b.id();
        b.string("serial");
      });
      await schema.create("wg_orders", (b) => {
        b.id();
        b.string("number");
        b.integer("customer_id").nullable();
      });
      await schema.create("wg_lines", (b) => {
        b.id();
        b.integer("order_id");
        b.integer("stock_id").nullable();
        b.string("name");
        b.integer("active");
      });

      const ann = await Customer.create({ name: "Ann", vip: 0 });
      const bob = await Customer.create({ name: "Bob", vip: 0, referrer_id: ann.id });
      const phone = await Stock.create({ serial: "IMEI-1" });
      const a = await Order.create({ number: "A", customer_id: ann.id });
      const b = await Order.create({ number: "B", customer_id: bob.id });
      // No customer at all: a NULL foreign key.
      await Order.create({ number: "C", customer_id: null });
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

    test("belongsTo whereDoesntHave keeps rows with a NULL foreign key", async () => {
      expect(await numbers(Order.query().whereDoesntHave("customer"))).toEqual(["C"]);
    });

    test("belongsTo whereDoesntHave with an or callback", async () => {
      const q = Order.query().whereDoesntHave("customer", (cq: any) => {
        cq.where("name", "Nobody").orWhere("name", "Ann");
      });
      expect(await numbers(q)).toEqual(["B", "C"]);
    });

    test("self-referencing belongsTo whereDoesntHave", async () => {
      const names = (await Customer.query().whereDoesntHave("referrer").get())
        .all()
        .map((row: Customer) => row.name);
      expect(names).toEqual(["Ann"]);
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

/**
 * Global scopes and soft deletes must hold when the query's own wheres use
 * `or`: `scope AND (a OR b)`, never `scope AND a OR b`.
 */
describe.each(drivers.map((d) => [d.name, d] as const))(
  "own or conditions stay behind scopes (%s)",
  (_name, driver) => {
    class Note extends Model {
      static table = "wo_notes";
      static timestamps = false;
      static fillable = ["post_id", "body"];
      declare id: number;
    }
    class Owner extends Model {
      static table = "wo_owners";
      static timestamps = false;
      static fillable = ["name", "tenant_id"];
      declare id: number;
    }
    class Post extends Model {
      static table = "wo_posts";
      static timestamps = false;
      static fillable = ["title", "tenant_id", "owner_id"];
      declare id: number;
      declare title: string;
      declare tenant_id: number;
      notes() {
        return this.hasMany(Note, "post_id");
      }
      owner() {
        return this.belongsTo(Owner, "owner_id");
      }
    }
    class Draft extends Model {
      static table = "wo_drafts";
      static timestamps = false;
      static softDeletes = true;
      static fillable = ["title"];
      declare title: string;
    }
    const tables = ["wo_notes", "wo_posts", "wo_owners", "wo_drafts"];
    const titles = async (query: any) =>
      (await query.get())
        .all()
        .map((row: { title: string }) => row.title)
        .sort();

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("wo_owners", (b) => {
        b.id();
        b.string("name");
        b.integer("tenant_id");
      });
      await schema.create("wo_posts", (b) => {
        b.id();
        b.string("title");
        b.integer("tenant_id");
        b.integer("owner_id");
      });
      await schema.create("wo_notes", (b) => {
        b.id();
        b.integer("post_id");
        b.string("body");
      });
      await schema.create("wo_drafts", (b) => {
        b.id();
        b.string("title");
        b.timestamp("deleted_at").nullable();
      });

      const ownOwner = await Owner.create({ name: "Mine", tenant_id: 1 });
      const otherOwner = await Owner.create({ name: "Theirs", tenant_id: 2 });
      const mine = await Post.create({ title: "mine", tenant_id: 1, owner_id: ownOwner.id });
      // Tenant 1 post pointing at another tenant's owner row.
      await Post.create({ title: "crossed", tenant_id: 1, owner_id: otherOwner.id });
      const theirs = await Post.create({ title: "theirs", tenant_id: 2, owner_id: otherOwner.id });
      await Note.create({ post_id: mine.id, body: "hello" });
      await Note.create({ post_id: theirs.id, body: "secret" });
      Post.addGlobalScope("tenant", (q) => q.where("wo_posts.tenant_id", 1));
      Owner.addGlobalScope("tenant", (q) => q.where("tenant_id", 1));

      await Draft.create({ title: "kept" });
      const gone = await Draft.create({ title: "gone" });
      await gone.delete();
    });

    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("top-level orWhere does not reach other tenants", async () => {
      const q = Post.query().where("title", "none").orWhere("title", "theirs");
      expect(await titles(q)).toEqual([]);
      expect(await q.count()).toBe(0);
    });

    test("top-level orWhereHas does not reach other tenants", async () => {
      const q = Post.query()
        .where("title", "none")
        .orWhereHas("notes", (nq: any) => {
          nq.where("body", "secret");
        });
      expect(await titles(q)).toEqual([]);
    });

    test("top-level orWhere does not bring back soft-deleted rows", async () => {
      expect(await titles(Draft.query().where("title", "none").orWhere("title", "gone"))).toEqual([]);
      expect(
        await titles(Draft.query().where("title", "kept").orWhere("title", "gone")),
      ).toEqual(["kept"]);
    });

    test("whereHas keeps its written place among plain wheres", async () => {
      // a OR (EXISTS notes AND b): with the EXISTS moved last it would read (a AND b) OR EXISTS.
      const q = Post.withoutGlobalScopes()
        .where("title", "mine")
        .orWhereHas("notes", (nq: any) => {
          nq.where("body", "secret");
        })
        .where("tenant_id", 2);
      expect(await titles(q)).toEqual(["mine", "theirs"]);
    });

    test("belongsTo whereHas applies the related model's global scopes (join)", async () => {
      const q = Post.query().whereHas("owner");
      expect(await titles(q)).toEqual(["mine"]);
    });

    test("belongsTo orWhereHas applies the related model's global scopes (IN)", async () => {
      const q = Post.query()
        .where("title", "none")
        .orWhereHas("owner", (oq: any) => {
          oq.where("name", "Theirs");
        });
      expect(await titles(q)).toEqual([]);
    });
  },
);
