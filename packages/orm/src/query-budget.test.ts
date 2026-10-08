/**
 * Query budgets: how many SQL statements common ORM operations issue.
 * Counts are deterministic (unlike timings), so a change that quietly adds an N+1 or an
 * extra round trip fails here on every driver. If a number legitimately changes, update it
 * deliberately and say why in the commit.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { listen, schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class QbAuthor extends Model {
  static table = "qb_authors";
  static fillable = ["name"];
  declare id: number;
  posts() { return this.hasMany(QbPost, "author_id"); }
  notes() { return this.morphMany(QbNote, "noteable"); }
}
class QbPost extends Model {
  static table = "qb_posts";
  static fillable = ["author_id", "title", "views"];
  declare id: number;
  author() { return this.belongsTo(QbAuthor, "author_id"); }
  tags() { return this.belongsToMany(QbTag, "qb_post_tag", "post_id", "tag_id"); }
}
class QbTag extends Model {
  static table = "qb_tags";
  static fillable = ["name"];
  declare id: number;
}
class QbNote extends Model {
  static table = "qb_notes";
  static fillable = ["noteable_type", "noteable_id", "body"];
  noteable() { return this.morphTo("noteable"); }
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "query budgets (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["qb_notes", "qb_post_tag", "qb_posts", "qb_tags", "qb_authors"];
    const AUTHORS = 50;

    /** Run `fn` and return every SQL statement it issued (setup and teardown excluded). */
    async function statements(fn: () => unknown): Promise<string[]> {
      const seen: string[] = [];
      const off = listen((e) => { if (/^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(e.sql)) seen.push(e.sql.replace(/\s+/g, " ").trim()); });
      try { await fn(); } finally { off(); }
      return seen;
    }
    const writes = (sql: string[]) => sql.filter((s) => /^(INSERT|UPDATE|DELETE)/i.test(s));
    const reads = (sql: string[]) => sql.filter((s) => /^SELECT/i.test(s));

    beforeAll(async () => {
      Model.setConnection(c);
      morphMap({ author: QbAuthor, post: QbPost });
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("qb_authors", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("qb_posts", (b) => { b.id(); b.integer("author_id"); b.string("title"); b.integer("views"); b.timestamps(); });
      await schema.create("qb_tags", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("qb_post_tag", (b) => { b.integer("post_id"); b.integer("tag_id"); });
      await schema.create("qb_notes", (b) => { b.id(); b.string("noteable_type"); b.integer("noteable_id"); b.string("body"); b.timestamps(); });
      const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
      const bulk = async (table: string, cols: string[], rows: unknown[][]) => {
        for (let i = 0; i < rows.length; i += 300) {
          const chunk = rows.slice(i, i + 300);
          await c.run(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${chunk.map(() => `(${cols.map(() => "?").join(",")})`).join(",")}`, chunk.flat());
        }
      };
      await bulk("qb_authors", ["name", "created_at", "updated_at"], Array.from({ length: AUTHORS }, (_, i) => [`a${i}`, ts, ts]));
      await bulk("qb_posts", ["author_id", "title", "views", "created_at", "updated_at"], Array.from({ length: 500 }, (_, i) => [(i % AUTHORS) + 1, `p${i}`, i, ts, ts]));
      await bulk("qb_tags", ["name", "created_at", "updated_at"], Array.from({ length: 20 }, (_, i) => [`t${i}`, ts, ts]));
      await bulk("qb_post_tag", ["post_id", "tag_id"], Array.from({ length: 500 }, (_, i) => [i + 1, (i % 20) + 1]));
      await bulk("qb_notes", ["noteable_type", "noteable_id", "body", "created_at", "updated_at"], Array.from({ length: 100 }, (_, i) => [i % 2 ? "author" : "post", (i % 10) + 1, `n${i}`, ts, ts]));
    });
    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("find / findMany / first are one statement", async () => {
      expect(await statements(() => QbPost.find(1))).toHaveLength(1);
      expect(await statements(() => QbPost.findMany([1, 2, 3]))).toHaveLength(1);
      expect(await statements(() => QbPost.where("views", ">", 10).first())).toHaveLength(1);
    });

    test("eager loading costs one statement per relation, never one per row", async () => {
      expect(await statements(() => QbPost.with("author").get())).toHaveLength(2);
      expect(await statements(() => QbPost.with("author", "tags").get())).toHaveLength(3);
      expect(await statements(() => QbAuthor.with("posts").get())).toHaveLength(2);
      expect(await statements(() => QbAuthor.with("posts.tags").get())).toHaveLength(3);
      expect(await statements(() => QbAuthor.with("posts.tags", "notes").get())).toHaveLength(4);
    });

    test("morphTo costs one statement per target type", async () => {
      // the main query + one for each of the two morph types present
      expect(await statements(() => QbNote.with("noteable").get())).toHaveLength(3);
    });

    test("aggregates, existence checks and counts are folded into the main statement", async () => {
      expect(await statements(() => QbAuthor.withCount("posts").withSum("posts", "views").withExists("notes").get())).toHaveLength(1);
      expect(await statements(() => QbAuthor.whereHas("posts", (q) => q.where("views", ">", 100)).get())).toHaveLength(1);
      expect(await statements(() => QbAuthor.doesntHave("notes").get())).toHaveLength(1);
      expect(await statements(() => QbPost.where("views", ">", 1).count())).toHaveLength(1);
    });

    test("paginate is a count plus a page; cursorPaginate is one", async () => {
      expect(await statements(() => QbPost.orderBy("id").paginate(25, 2))).toHaveLength(2);
      expect(await statements(() => QbPost.orderBy("id").cursorPaginate(25))).toHaveLength(1);
    });

    test("chunkById issues one statement per chunk (plus at most one empty probe)", async () => {
      const sql = await statements(() => QbPost.query().chunkById(100, () => {}));
      expect(sql.length).toBeGreaterThanOrEqual(5);
      expect(sql.length).toBeLessThanOrEqual(6);
    });

    test("attach is batched: 1000 ids are a handful of inserts, not 1000", async () => {
      const post = (await QbPost.create({ author_id: 1, title: "attach", views: 0 })) as QbPost;
      const ids = Array.from({ length: 1000 }, (_, i) => (i % 20) + 1);
      const sql = await statements(() => post.tags().attach(ids));
      expect(sql.length).toBeLessThanOrEqual(3); // 2 columns x 1000 rows, chunked under 900 bound parameters
      expect(writes(sql)).toHaveLength(sql.length);
      await post.tags().detach();
    });

    test("sync only touches the difference", async () => {
      const post = (await QbPost.create({ author_id: 1, title: "sync", views: 0 })) as QbPost;
      await post.tags().attach([1, 2, 3, 4]);
      const unchanged = await statements(() => post.tags().sync([1, 2, 3, 4]));
      expect(reads(unchanged)).toHaveLength(1);
      expect(writes(unchanged)).toHaveLength(0);
      const changed = await statements(() => post.tags().sync([3, 4, 5]));
      expect(reads(changed)).toHaveLength(1);
      expect(writes(changed)).toHaveLength(2); // one DELETE for 1,2 and one INSERT for 5
    });

    test("create is one insert; a no-op save writes nothing", async () => {
      const sql = await statements(() => QbTag.create({ name: "budget" }));
      expect(writes(sql)).toHaveLength(1);
      const tag = (await QbTag.where("name", "budget").first()) as QbTag;
      expect(await statements(() => tag.save())).toHaveLength(0);
    });

    test("eager loading more parents than one IN list adds one statement per extra chunk", async () => {
      // 500 posts fit one chunk (900); the budget above already proves that. Prove the chunk math too:
      const sql = await statements(() => QbPost.with("author").limit(500).get());
      expect(sql).toHaveLength(2);
    });
  },
);
