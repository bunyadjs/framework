import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class SqAuthor extends Model {
  static table = "sq_authors";
  static fillable = ["name", "age"];
  declare id: number;
  declare name: string;
  declare age: number;
}
class SqPost extends Model {
  static table = "sq_posts";
  static fillable = ["author_id", "title", "views"];
  declare id: number;
  declare title: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "subqueries, unions and sub-joins (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const num = (v: unknown) => Number(v);
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of ["sq_posts", "sq_authors"]) await schema.dropIfExists(t);
      await schema.create("sq_authors", (b) => { b.id(); b.string("name"); b.integer("age"); b.timestamps(); });
      await schema.create("sq_posts", (b) => { b.id(); b.integer("author_id"); b.string("title"); b.integer("views"); b.timestamps(); });
      for (const [n, a] of [["ann", 20], ["bob", 30], ["cy", 40]] as const) await SqAuthor.create({ name: n, age: a });
      await SqPost.create({ author_id: 1, title: "a1", views: 10 });
      await SqPost.create({ author_id: 1, title: "a2", views: 50 });
      await SqPost.create({ author_id: 2, title: "b1", views: 5 });
    });
    afterAll(async () => {
      const schema = schemaFor(c);
      for (const t of ["sq_posts", "sq_authors"]) await schema.dropIfExists(t);
    });
    const names = async (q: { get(): unknown }) => ((await q.get()) as { pluck(c: string): { all(): string[] } }).pluck("name").all().sort();

    test("selectSub adds a correlated subquery column", async () => {
      const rows = await SqAuthor.query()
        .select("sq_authors.*")
        .selectSub((q) => { q.from("sq_posts").selectRaw("COUNT(*)").whereColumn("sq_posts.author_id", "sq_authors.id"); }, "post_count")
        .orderBy("id")
        .get();
      expect((rows.all() as any[]).map((r) => num(r.post_count))).toEqual([2, 1, 0]);
    });

    test("selectSub also accepts a model query", async () => {
      const rows = await SqAuthor.query()
        .select("sq_authors.*")
        .selectSub(SqPost.query().selectRaw("MAX(views)").whereColumn("sq_posts.author_id", "sq_authors.id"), "top_views")
        .orderBy("id")
        .get();
      expect((rows.all() as any[]).map((r) => (r.top_views == null ? null : num(r.top_views)))).toEqual([50, 5, null]);
    });

    test("whereExists / whereNotExists with a closure and a model query", async () => {
      expect(await names(SqAuthor.query().whereExists((q) => { q.from("sq_posts").whereColumn("sq_posts.author_id", "sq_authors.id"); }))).toEqual(["ann", "bob"]);
      expect(await names(SqAuthor.query().whereNotExists(SqPost.query().whereColumn("sq_posts.author_id", "sq_authors.id")))).toEqual(["cy"]);
      expect(await names(SqAuthor.where("name", "cy").orWhereExists(SqPost.query().whereColumn("sq_posts.author_id", "sq_authors.id").where("views", ">", 40)))).toEqual(["ann", "cy"]);
    });

    test("union and unionAll of two model queries", async () => {
      const young = SqAuthor.query().select("name").where("age", "<", 25);
      const old = SqAuthor.query().select("name").where("age", ">", 35);
      expect(await names(young.union(old))).toEqual(["ann", "cy"]);
      const twice = await SqAuthor.query().select("name").where("age", "<", 25).unionAll(SqAuthor.query().select("name").where("age", "<", 25)).get();
      expect(twice.count()).toBe(2);
    });

    test("joinSub / leftJoinSub join against an aggregate subquery", async () => {
      const totals = SqPost.query().select("author_id").selectRaw("SUM(views) AS total").groupBy("author_id");
      const rows = await SqAuthor.query()
        .select("sq_authors.name", "t.total")
        .leftJoinSub(totals, "t", "t.author_id", "=", "sq_authors.id")
        .orderBy("sq_authors.id")
        .rows()
        .get();
      expect(rows.map((r: any) => (r.total == null ? null : num(r.total)))).toEqual([60, 5, null]);
      const inner = await SqAuthor.query()
        .select("sq_authors.name")
        .joinSub(totals, "t", "t.author_id", "=", "sq_authors.id")
        .where("t.total", ">", 10)
        .rows()
        .get();
      expect(inner.map((r: any) => r.name)).toEqual(["ann"]);
    });

    test("crossJoin and groupByRaw", async () => {
      const rows = await SqAuthor.query().select("sq_authors.name", "sq_posts.title").crossJoin("sq_posts").rows().get();
      expect(rows.length).toBe(9);
      const grouped = await SqPost.query().selectRaw("author_id, COUNT(*) AS n").groupByRaw("author_id").orderBy("author_id").rows().get();
      expect(grouped.map((r: any) => num(r.n))).toEqual([2, 1]);
    });
  },
);
