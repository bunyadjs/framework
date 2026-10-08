import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, unsafeName } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class SfAuthor extends Model {
  static table = "sf_authors";
  static fillable = ["name", "age"];
  declare id: number;
  declare name: string;
  declare age: number;
  books() { return this.hasMany(SfBook, "author_id"); }
}
class SfBook extends Model {
  static table = "sf_books";
  static fillable = ["author_id", "title"];
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "static query-builder forwarding, like Laravel's __callStatic (%s)",
  (_name, driver) => {
    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of ["sf_books", "sf_authors"]) await schema.dropIfExists(t);
      await schema.create("sf_authors", (b) => { b.id(); b.string("name"); b.integer("age"); b.timestamps(); });
      await schema.create("sf_books", (b) => { b.id(); b.integer("author_id"); b.string("title"); b.timestamps(); });
      for (const [name, age] of [["a", 20], ["b", 30], ["c", 40], ["d", 50]] as const) {
        await SfAuthor.create({ name, age });
      }
      await SfBook.create({ author_id: 1, title: "t1" });
      await SfBook.create({ author_id: 1, title: "t2" });
      await SfBook.create({ author_id: 3, title: "t3" });
    });
    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of ["sf_books", "sf_authors"]) await schema.dropIfExists(t);
    });

    test("where-family helpers", async () => {
      expect((await SfAuthor.whereBetween("age", [25, 45]).get()).count()).toBe(2);
      expect((await SfAuthor.whereNotBetween("age", [25, 45]).get()).count()).toBe(2);
      expect((await SfAuthor.whereNotIn("name", ["a", "b"]).get()).count()).toBe(2);
      expect((await SfAuthor.whereRaw("age > ?", [35]).get()).count()).toBe(2);
      expect((await SfAuthor.where("age", ">", 100).orWhereIn("name", ["a"]).get()).count()).toBe(1);
      expect((await SfAuthor.whereColumn("id", "<", "age").get()).count()).toBe(4);
      expect((await SfAuthor.whereLike("name", "a%").get()).count()).toBe(1);
    });

    test("relationship existence helpers", async () => {
      expect((await SfAuthor.has("books").get()).pluck("name").all().sort()).toEqual(["a", "c"]);
      expect((await SfAuthor.doesntHave("books").get()).pluck("name").all().sort()).toEqual(["b", "d"]);
    });

    test("ordering, paging and conditionals", async () => {
      expect((await SfAuthor.orderBy("age", "desc").offset(1).limit(2).get()).pluck("name").all()).toEqual(["c", "b"]);
      expect((await SfAuthor.when(true, (q) => q.where("name", "a")).get()).count()).toBe(1);
      expect((await SfAuthor.unless(true, (q) => q.where("name", "a")).get()).count()).toBe(4);
      expect((await SfAuthor.inRandomOrder().get()).count()).toBe(4);
    });

    test("grouping and raw selects", async () => {
      const rows = await SfAuthor.selectRaw("COUNT(*) AS n, age > 25 AS older")
        .groupBy("older")
        .orderBy(unsafeName("older"))
        .rows()
        .get();
      expect(rows.map((r) => Number((r as Record<string, unknown>).n))).toEqual([1, 3]);
    });

    test("terminals and finders", async () => {
      expect(await SfAuthor.count()).toBe(4);
      expect(Number(await SfAuthor.max("age"))).toBe(50);
      expect(Number(await SfAuthor.sum("age"))).toBe(140);
      expect(await SfAuthor.exists()).toBe(true);
      expect(await SfAuthor.doesntExist()).toBe(false);
      expect((await SfAuthor.firstWhere("name", "=", "b"))?.age).toBe(30);
      expect((await SfAuthor.findMany([1, 2])).count()).toBe(2);
      expect(await SfAuthor.where("name", "zzz").firstOr(() => SfAuthor.where("name", "a").firstOrFail())).toMatchObject({ name: "a" });
      expect(SfAuthor.where("name", "a").toSql()).toContain("sf_authors");
    });

    test("chunkById through the static helper", async () => {
      const seen: number[] = [];
      await SfAuthor.chunkById(2, (rows) => { for (const r of rows.all()) seen.push((r as SfAuthor).id); });
      expect(seen).toEqual([1, 2, 3, 4]);
    });
  },
);
