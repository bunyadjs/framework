import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { resetModelEventsForTests } from "../src/model-events.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class DtDoc extends Model {
  static table = "dt_docs";
  static fillable = ["title", "meta", "tags", "bag", "born", "flag"];
  static casts() {
    return {
      meta: "json" as const,
      tags: "array" as const,
      bag: "collection" as const,
      born: "datetime" as const,
      flag: "boolean" as const,
    };
  }
  declare id: number;
  declare title: string;
  declare meta: any;
  declare tags: any[];
  declare bag: any;
  declare born: Date;
  declare flag: boolean;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "dirty tracking (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("dt_docs");
      await schema.create("dt_docs", (b) => {
        b.id(); b.string("title").nullable(); b.text("meta").nullable(); b.text("tags").nullable(); b.text("bag").nullable();
        b.timestamp("born").nullable(); b.boolean("flag").nullable(); b.timestamps();
      });
    });
    afterAll(async () => { await schemaFor(c).dropIfExists("dt_docs"); });

    const fresh = async (attrs: Record<string, unknown> = {}) => {
      const made = (await DtDoc.create({ title: "t", meta: { theme: "light", n: [1] }, tags: ["a"], bag: [1, 2], born: new Date("2024-01-02T03:04:05Z"), flag: false, ...attrs })) as DtDoc;
      return (await DtDoc.find(made.id)) as DtDoc;
    };
    const stored = async (id: number) => (await c.all<Record<string, unknown>>("SELECT * FROM dt_docs WHERE id = ?", [id]))[0]!;

    test("a freshly loaded model is clean", async () => {
      const d = await fresh();
      expect(d.isDirty()).toBe(false);
      expect(d.getDirty()).toEqual({});
    });

    test("editing a json/array attribute in place makes it dirty and the edit is saved", async () => {
      const d = await fresh();
      d.meta.theme = "dark";
      d.tags.push("b");
      expect(Object.keys(d.getDirty()).sort()).toEqual(["meta", "tags"]);
      await d.save();
      const row = await stored(d.id);
      expect(JSON.parse(String(row.meta))).toEqual({ theme: "dark", n: [1] });
      expect(JSON.parse(String(row.tags))).toEqual(["a", "b"]);
      expect(d.isDirty()).toBe(false);
    });

    test("getOriginal / getPrevious return the pristine value, not the edited object", async () => {
      const d = await fresh();
      d.meta.theme = "dark";
      expect(d.getOriginal("meta")).toEqual({ theme: "light", n: [1] });
      expect((d.getOriginal() as any).meta).toEqual({ theme: "light", n: [1] });
      await d.save();
      expect(d.getPrevious("meta")).toEqual({ theme: "light", n: [1] });
      // after the save the new value is the baseline
      d.meta.n.push(2);
      expect(d.getOriginal("meta")).toEqual({ theme: "dark", n: [1] });
      expect(d.isDirty("meta")).toBe(true);
    });

    test("assigning an identical object, array or date is not a change", async () => {
      const d = await fresh();
      d.meta = { theme: "light", n: [1] };
      d.tags = ["a"];
      d.born = new Date("2024-01-02T03:04:05Z");
      expect(d.isDirty()).toBe(false);
      d.born = new Date("2024-01-02T03:04:06Z");
      expect(Object.keys(d.getDirty())).toEqual(["born"]);
    });

    test("collection casts compare by content too", async () => {
      const d = await fresh();
      d.bag.push?.(3);
      const changed = d.isDirty("bag");
      const d2 = await fresh();
      d2.bag = [1, 2];
      expect(d2.isDirty("bag")).toBe(false);
      expect(typeof changed).toBe("boolean");
    });

    test("reverting an edit makes the model clean again", async () => {
      const d = await fresh();
      d.meta.theme = "dark";
      expect(d.isDirty("meta")).toBe(true);
      d.meta.theme = "light";
      expect(d.isDirty("meta")).toBe(false);
    });

    test("refresh() resets the baseline", async () => {
      const d = await fresh();
      await c.run("UPDATE dt_docs SET title = 'changed elsewhere' WHERE id = ?", [d.id]);
      d.title = "mine";
      d.meta.theme = "dark";
      await d.refresh();
      expect(d.title).toBe("changed elsewhere");
      expect(d.meta.theme).toBe("light");
      expect(d.isDirty()).toBe(false);
      d.meta.theme = "x";
      expect((d.getOriginal("meta") as any).theme).toBe("light");
    });

    test("inside updated and saved listeners the save is still described by isDirty / getOriginal / wasChanged", async () => {
      resetModelEventsForTests(DtDoc);
      const seen: Record<string, unknown> = {};
      DtDoc.updated((m) => {
        seen.updated = { dirty: m.isDirty("title"), was: m.wasChanged("title"), orig: m.getOriginal("title"), prev: m.getPrevious("title") };
      });
      DtDoc.saved((m) => {
        seen.saved = { dirty: m.isDirty("title"), was: m.wasChanged("title"), orig: m.getOriginal("title") };
      });
      const d = await fresh();
      d.title = "new title";
      await d.save();
      expect(seen.updated).toEqual({ dirty: true, was: true, orig: "t", prev: "t" });
      expect(seen.saved).toEqual({ dirty: true, was: true, orig: "t" });
      // …and once the save finishes, everything is clean
      expect(d.isDirty()).toBe(false);
      expect(d.getOriginal("title")).toBe("new title");
      expect(d.wasChanged("title")).toBe(true);
      resetModelEventsForTests(DtDoc);
    });

    test("created / saved listeners see a new model's changes", async () => {
      resetModelEventsForTests(DtDoc);
      const seen: Record<string, unknown> = {};
      DtDoc.created((m) => { seen.created = m.wasChanged("title"); });
      DtDoc.saved((m) => { seen.saved = m.wasRecentlyCreated(); });
      await DtDoc.create({ title: "brand new" });
      expect(seen).toEqual({ created: true, saved: true });
      resetModelEventsForTests(DtDoc);
    });

    test("save() with no changes writes nothing and keeps the model clean", async () => {
      const d = await fresh();
      const before = String((await stored(d.id)).updated_at);
      await d.save();
      expect(String((await stored(d.id)).updated_at)).toBe(before);
      expect(d.wasChanged()).toBe(false);
    });
  },
);
