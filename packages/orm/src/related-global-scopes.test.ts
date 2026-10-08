import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "related global scopes are applied through relations (%s)",
  (_name, driver) => {
    class Shop extends Model {
      static table = "gs_shops";
      static fillable = ["name"];
      declare id: number;
      declare name: string;
      items() {
        return this.hasMany(Item, "shop_id");
      }
      tags() {
        return this.belongsToMany(Item, "gs_shop_item", "shop_id", "item_id");
      }
    }
    class Item extends Model {
      static table = "gs_items";
      static fillable = ["shop_id", "name", "active"];
      declare id: number;
      static booted() {
        Item.addGlobalScope("active", (q) => q.where("active", 1));
      }
    }
    const tables = ["gs_shop_item", "gs_items", "gs_shops"];
    const num = (v: unknown) => Number(v);

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      Item.addGlobalScope("active", (q) => q.where("active", 1));
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("gs_shops", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("gs_items", (b) => {
        b.id();
        b.integer("shop_id");
        b.string("name");
        b.integer("active");
        b.timestamps();
      });
      await schema.create("gs_shop_item", (b) => { b.integer("shop_id"); b.integer("item_id"); });
      const a = await Shop.create({ name: "A" });
      const b = await Shop.create({ name: "B" });
      const i1 = await Item.withoutGlobalScopes().create({ shop_id: a.id, name: "on1", active: 1 });
      const i2 = await Item.withoutGlobalScopes().create({ shop_id: a.id, name: "off1", active: 0 });
      await Item.withoutGlobalScopes().create({ shop_id: b.id, name: "off2", active: 0 });
      await a.tags().attach([i1.id, i2.id]);
      await b.tags().attach([i2.id]);
    });

    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("lazy relation get()", async () => {
      const a = (await Shop.where("name", "A").first()) as Shop;
      expect((await a.items().get()).pluck("name").all()).toEqual(["on1"]);
    });

    test("eager load hasMany", async () => {
      const shops = await Shop.with("items").orderBy("id").get();
      const [a, b] = shops.all() as unknown as Array<{ items: { count(): number } }>;
      expect(a!.items.count()).toBe(1);
      expect(b!.items.count()).toBe(0);
    });

    test("withCount / withExists", async () => {
      const rows = await Shop.withCount("items").withExists("items").orderBy("id").get();
      const [a, b] = rows.all() as unknown as Array<Record<string, unknown>>;
      expect(num(a!.items_count)).toBe(1);
      expect(num(b!.items_count)).toBe(0);
      expect(num(a!.items_exists)).toBe(1);
      expect(num(b!.items_exists) || 0).toBe(0);
    });

    test("withCount on belongsToMany", async () => {
      const rows = await Shop.withCount("tags").orderBy("id").get();
      const [a, b] = rows.all() as unknown as Array<Record<string, unknown>>;
      expect(num(a!.tags_count)).toBe(1);
      expect(num(b!.tags_count)).toBe(0);
    });

    test("whereHas ignores inactive related rows", async () => {
      const shops = await Shop.whereHas("items").get();
      expect(shops.pluck("name").all()).toEqual(["A"]);
    });

    test("eager load belongsToMany", async () => {
      const shops = await Shop.with("tags").orderBy("id").get();
      const [a, b] = shops.all() as unknown as Array<{ tags: { count(): number } }>;
      expect(a!.tags.count()).toBe(1);
      expect(b!.tags.count()).toBe(0);
    });

    test("withoutGlobalScopes bypasses inside a constraint", async () => {
      const rows = await Shop.withCount({
        "items as all_items": (q) => q.withoutGlobalScopes(),
      })
        .orderBy("id")
        .get();
      const [a, b] = rows.all() as unknown as Array<Record<string, unknown>>;
      expect(num(a!.all_items)).toBe(2);
      expect(num(b!.all_items)).toBe(1);
    });
  },
);
