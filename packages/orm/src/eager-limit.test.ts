import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class ElShop extends Model {
  static table = "el_shops";
  static fillable = ["name"];
  declare id: number;
  items() { return this.hasMany(ElItem, "shop_id"); }
  notes() { return this.morphMany(ElNote, "noteable"); }
  tags() { return this.belongsToMany(ElTag, "el_shop_tag", "shop_id", "tag_id"); }
}
class ElItem extends Model {
  static table = "el_items";
  static fillable = ["shop_id", "n"];
  declare n: number;
}
class ElNote extends Model {
  static table = "el_notes";
  static fillable = ["noteable_type", "noteable_id", "n"];
  declare n: number;
}
class ElTag extends Model {
  static table = "el_tags";
  static fillable = ["n"];
  declare n: number;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "eager-load limit / offset apply per parent (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["el_shop_tag", "el_tags", "el_notes", "el_items", "el_shops"];
    const SHOPS = 1100; // more parents than one IN-list chunk

    beforeAll(async () => {
      Model.setConnection(c);
      morphMap({ shop: ElShop });
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("el_shops", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("el_items", (b) => { b.id(); b.integer("shop_id"); b.integer("n"); b.timestamps(); });
      await schema.create("el_notes", (b) => { b.id(); b.string("noteable_type"); b.integer("noteable_id"); b.integer("n"); b.timestamps(); });
      await schema.create("el_tags", (b) => { b.id(); b.integer("n"); b.timestamps(); });
      await schema.create("el_shop_tag", (b) => { b.integer("shop_id"); b.integer("tag_id"); });
      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const bulk = async (table: string, cols: string[], rows: unknown[][]) => {
        for (let i = 0; i < rows.length; i += 300) {
          const chunk = rows.slice(i, i + 300);
          await c.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",")}`, chunk.flat());
        }
      };
      await bulk("el_shops", ["name", "created_at", "updated_at"], Array.from({ length: SHOPS }, (_, i) => [`s${i + 1}`, ts, ts]));
      // shop i has (i % 5) + 1 rows of each kind, n = 1..k
      const items: unknown[][] = [], notes: unknown[][] = [], links: unknown[][] = [];
      for (let i = 1; i <= SHOPS; i++) {
        const k = (i % 5) + 1;
        for (let n = 1; n <= k; n++) {
          items.push([i, n, ts, ts]);
          notes.push(["shop", i, n, ts, ts]);
          links.push([i, n]);
        }
      }
      await bulk("el_items", ["shop_id", "n", "created_at", "updated_at"], items);
      await bulk("el_notes", ["noteable_type", "noteable_id", "n", "created_at", "updated_at"], notes);
      await bulk("el_tags", ["n", "created_at", "updated_at"], Array.from({ length: 5 }, (_, i) => [i + 1, ts, ts]));
      await bulk("el_shop_tag", ["shop_id", "tag_id"], links);
    }, 60_000);
    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    const check = (shops: { all(): unknown[] }, rel: string, pick: (x: any) => number, limit: number, offset = 0) => {
      for (const shop of shops.all() as any[]) {
        const k = (shop.id % 5) + 1;
        const all = Array.from({ length: k }, (_, i) => i + 1);
        const expected = all.slice(offset, offset + limit);
        const got = shop[rel].all().map(pick);
        expect(got, `shop ${shop.id} ${rel}`).toEqual(expected);
      }
    };

    test("hasMany: limit(2) per parent, across multiple IN-list chunks", async () => {
      const shops = await ElShop.with({ items: (q: any) => q.orderBy("n").limit(2) }).get();
      expect(shops.count()).toBe(SHOPS);
      check(shops, "items", (i) => i.n, 2);
    });

    test("hasMany: offset + limit per parent", async () => {
      const shops = await ElShop.with({ items: (q: any) => q.orderBy("n").offset(1).limit(2) }).get();
      check(shops, "items", (i) => i.n, 2, 1);
    });

    test("morphMany and belongsToMany: limit per parent", async () => {
      const shops = await ElShop.with({
        notes: (q: any) => q.orderBy("n", "desc").limit(1),
        tags: (q: any) => q.orderBy("el_tags.n").limit(2),
      }).whereIn("id", [1, 2, 3, 4, 5, 6]).get();
      for (const shop of shops.all() as any[]) {
        const k = (shop.id % 5) + 1;
        expect(shop.notes.all().map((n: any) => n.n)).toEqual([k]);
        expect(shop.tags.all().map((t: any) => t.n)).toEqual(Array.from({ length: k }, (_, i) => i + 1).slice(0, 2));
      }
    });

    test("without a limit nothing is trimmed", async () => {
      const shops = await ElShop.with({ items: (q: any) => q.orderBy("n") }).whereIn("id", [4, 5]).get();
      expect((shops.all() as any[]).map((s) => s.items.count())).toEqual([5, 1]);
    });
  },
);
