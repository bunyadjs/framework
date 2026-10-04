import { afterEach, expect, test } from "bun:test";
import {
  clearQueryListeners,
  connectPostgres,
  connectSqlite,
  listen,
  schemaFor,
  type Connection,
} from "@bunyad/database";
import { Model, SoftDeletes } from "./index.ts";

afterEach(() => clearQueryListeners());

async function setup(connection: Connection, prefix: string) {
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.dropIfExists(`${prefix}_posts`);
  await schema.dropIfExists(`${prefix}_authors`);
  await schema.create(`${prefix}_authors`, (t) => {
    t.id();
    t.string("name");
  });
  await schema.create(`${prefix}_posts`, (t) => {
    t.id();
    t.string("title");
    t.integer("author_id");
    t.timestamp("deleted_at").nullable();
  });

  class Author extends Model {
    static table = `${prefix}_authors`;
    static timestamps = false;
    static fillable = ["name"];
    declare name: string;
  }
  @SoftDeletes()
  class Post extends Model {
    static table = `${prefix}_posts`;
    static timestamps = false;
    static fillable = ["title", "author_id"];
    declare title: string;
    declare author_id: number;
    author() {
      return this.belongsTo(Author, "author_id");
    }
  }

  const a = await Author.create({ name: "Ada" });
  const b = await Author.create({ name: "Bob" });
  for (let i = 1; i <= 12; i++) {
    await Post.create({ title: `post-${i}`, author_id: i % 2 === 0 ? a.id : b.id });
  }
  return { Author, Post };
}

async function collect<T>(rows: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const row of rows) out.push(row);
  return out;
}

test("cursor yields hydrated models in order, matching get()", async () => {
  const { Post } = await setup(connectSqlite(), "c1");
  const streamed = await collect(Post.query().orderBy("id").cursor(5));
  const fetched = await Post.query().orderBy("id").get();

  expect(streamed).toHaveLength(12);
  expect(streamed[0]).toBeInstanceOf(Post);
  expect(streamed.map((m) => m.title)).toEqual(fetched.all().map((m) => m.title));
  expect(streamed.every((m) => m.exists)).toBe(true);
});

test("cursor applies constraints and soft-delete scoping", async () => {
  const { Post } = await setup(connectSqlite(), "c2");
  await (await Post.query().where("title", "post-3").first())!.delete();

  const live = await collect(Post.query().orderBy("id").cursor());
  expect(live).toHaveLength(11);
  expect(live.map((m) => m.title)).not.toContain("post-3");

  const all = await collect(Post.withTrashed().orderBy("id").cursor());
  expect(all).toHaveLength(12);

  const some = await collect(Post.query().where("author_id", 1).orderBy("id").cursor());
  expect(some.every((m) => m.author_id === 1)).toBe(true);
});

test("cursor runs a single query while lazy pages", async () => {
  const { Post } = await setup(connectSqlite(), "c3");
  const seen: string[] = [];
  listen((event) => seen.push(event.sql));

  await collect(Post.query().orderBy("id").cursor(3));
  const cursorQueries = seen.length;
  seen.length = 0;
  await collect(Post.query().orderBy("id").lazy(3));

  expect(cursorQueries).toBe(1);
  expect(seen.length).toBeGreaterThan(1);
});

test("model cursor chains like a LazyCollection", async () => {
  const { LazyCollection } = await import("@bunyad/common");
  const { Post } = await setup(connectSqlite(), "c9");
  expect(Post.cursor()).toBeInstanceOf(LazyCollection);
  expect(Post.query().lazy()).toBeInstanceOf(LazyCollection);

  const titles = await Post.query()
    .orderBy("id")
    .cursor(4)
    .filter((post) => Number(post.id) % 3 === 0)
    .map((post) => post.title)
    .toArray();
  expect(titles).toEqual(["post-3", "post-6", "post-9", "post-12"]);

  const first = await Post.query().orderBy("id").cursor().first();
  expect(first).toBeInstanceOf(Post);
  expect(first!.title).toBe("post-1");
  expect(await Post.cursor().count()).toBe(12);
  expect((await Post.query().orderBy("id").cursor(5).chunk(5).toArray()).map((c) => c.count())).toEqual([5, 5, 2]);
});

test("cursor fires retrieved for every model", async () => {
  const { Post } = await setup(connectSqlite(), "c4");
  let retrieved = 0;
  Post.retrieved(() => {
    retrieved++;
  });
  await collect(Post.query().cursor());
  expect(retrieved).toBe(12);
});

test("cursor eager loads with() once per batch, not per model", async () => {
  const { Post } = await setup(connectSqlite(), "c5");
  const seen: string[] = [];
  listen((event) => seen.push(event.sql));

  const posts = await collect(Post.query().with("author").orderBy("id").cursor(5));
  expect(posts).toHaveLength(12);
  expect(posts.every((p) => p.relationLoaded("author"))).toBe(true);
  expect((posts.find((p) => p.title === "post-2") as unknown as { author: { name: string } }).author.name).toBe("Ada");

  // 1 streamed select + 3 authors lookups (12 posts / batches of 5), never 12.
  const authorQueries = seen.filter((sql) => sql.includes("c5_authors")).length;
  expect(authorQueries).toBe(3);
});

test("abandoning a model cursor early leaves the connection usable", async () => {
  const { Post } = await setup(connectSqlite(), "c6");
  let taken = 0;
  for await (const _post of Post.query().orderBy("id").cursor(2)) {
    if (++taken === 3) break;
  }
  expect(taken).toBe(3);
  expect(await Post.query().count()).toBe(12);
  await Post.create({ title: "after", author_id: 1 });
  expect(await Post.query().count()).toBe(13);
});

test("models can be updated while the cursor is open (sqlite)", async () => {
  const { Post } = await setup(connectSqlite(), "c7");
  for await (const post of Post.query().orderBy("id").cursor(4)) {
    post.title = `${post.title}!`;
    await post.save();
  }
  expect(await Post.query().where("title", "like", "%!").count()).toBe(12);
});

test("static Model.cursor / lazy / lazyById match the query forms", async () => {
  const { Post } = await setup(connectSqlite(), "c8");
  const seen: string[] = [];
  listen((event) => seen.push(event.sql));

  const cursor = await collect(Post.cursor());
  expect(cursor).toHaveLength(12);
  expect(cursor[0]).toBeInstanceOf(Post);
  expect(seen).toHaveLength(1);

  const titles = (rows: { title: string }[]) => rows.map((m) => m.title).sort();
  expect(titles(await collect(Post.lazy(5)))).toEqual(titles(cursor));
  const byId = await collect(Post.lazyById(5));
  expect(byId.map((m) => m.id)).toEqual(cursor.map((m) => m.id).sort((a, b) => Number(a) - Number(b)));
  const desc = await collect(Post.lazyByIdDesc(5));
  expect(desc.map((m) => m.id)).toEqual([...byId.map((m) => m.id)].reverse());
});

const postgresUrl = process.env.BUNYAD_TEST_POSTGRES_URL;

test.skipIf(!postgresUrl)("cursor streams models over Postgres", async () => {
  const connection = connectPostgres({ url: postgresUrl!, max: 4 });
  try {
    const { Post } = await setup(connection, "cpg");
    const streamed = await collect(Post.query().with("author").orderBy("id").cursor(5));
    expect(streamed).toHaveLength(12);
    expect(streamed[0]).toBeInstanceOf(Post);
    expect(streamed.every((p) => p.relationLoaded("author"))).toBe(true);

    let taken = 0;
    for await (const _post of Post.query().orderBy("id").cursor(2)) {
      if (++taken === 2) break;
    }
    expect(await Post.query().count()).toBe(12);
  } finally {
    const schema = schemaFor(connection);
    await schema.dropIfExists("cpg_posts").catch(() => undefined);
    await schema.dropIfExists("cpg_authors").catch(() => undefined);
    await connection.close();
  }
});
