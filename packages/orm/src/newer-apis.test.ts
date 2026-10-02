/**
 * Newer model / query APIs — existence + behavior.
 */
import { expect, test } from "bun:test";
import {
  connectSqlite,
  schemaFor,
  setDefaultConnection,
  DB,
} from "@bunyad/database";
import { Model, OrmCollection } from "../src/index.ts";

test("QueryBuilder whereAny / whereAll / whereNone", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.string("email");
  });
  await DB.table("users").insert({ name: "Ada", email: "a@b.c" });
  await DB.table("users").insert({ name: "Bob", email: "x@y.z" });

  const any = await DB.table("users")
    .whereAny(["name", "email"], "like", "%Ada%")
    .get();
  expect(any.count()).toBe(1);

  const all = await DB.table("users")
    .whereAll(["name", "email"], "!=", "")
    .get();
  expect(all.count()).toBe(2);

  const none = await DB.table("users")
    .whereNone(["name", "email"], "like", "%zzz%")
    .get();
  expect(none.count()).toBe(2);

  await connection.close();
});

test("withSum withExists withCount alias whereBelongsTo findMany", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("authors", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("posts", (table) => {
    table.id();
    table.string("title");
    table.integer("author_id");
    table.integer("votes").default(0);
  });

  class Author extends Model {
    static table = "authors";
    static timestamps = false;
    static fillable = ["name"];
    posts() {
      return this.hasMany(Post, "author_id");
    }
  }
  class Post extends Model {
    static table = "posts";
    static timestamps = false;
    static fillable = ["title", "author_id", "votes"];
    declare title: string;
    author() {
      return this.belongsTo(Author, "author_id");
    }
  }

  const author = await Author.create({ name: "Ada" });
  await Post.create({ title: "One", author_id: author.id, votes: 3 });
  await Post.create({ title: "Two", author_id: author.id, votes: 7 });

  const summed = await Author.withSum("posts", "votes").first();
  expect(Number((summed as unknown as Record<string, unknown>).posts_sum_votes)).toBe(10);

  const exists = await Author.withExists("posts").first();
  expect(Number((exists as unknown as Record<string, unknown>).posts_exists)).toBe(1);

  const aliased = await Author.withCount("posts as post_total").first();
  expect(Number((aliased as unknown as Record<string, unknown>).post_total)).toBe(2);

  const aliasedList = await Author.withCount(["posts as post_total"]).first();
  expect(Number((aliasedList as unknown as Record<string, unknown>).post_total)).toBe(2);

  const viaBelongs = await Post.whereBelongsTo(author).get();
  expect(viaBelongs).toBeInstanceOf(OrmCollection);
  expect(viaBelongs.count()).toBe(2);

  const many = await Post.whereKey([1, 2]).get();
  expect(many.count()).toBe(2);

  const found = await Post.newQuery().findMany([1]);
  expect(found.count()).toBe(1);

  const fw = await Post.newQuery().firstWhere("title", "One");
  expect(fw?.title).toBe("One");

  const any = await Post.whereAny(["title"], "like", "%Two%").get();
  expect(any.count()).toBe(1);

  await connection.close();
});

test("withWhereHas eager + constraint", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("shops", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("items", (table) => {
    table.id();
    table.string("title");
    table.integer("shop_id");
    table.integer("featured").default(0);
  });

  class Shop extends Model {
    static table = "shops";
    static timestamps = false;
    static fillable = ["name"];
    declare name: string;
    items() {
      return this.hasMany(Item, "shop_id");
    }
  }
  class Item extends Model {
    static table = "items";
    static timestamps = false;
    static fillable = ["title", "shop_id", "featured"];
  }

  const s1 = await Shop.create({ name: "A" });
  const s2 = await Shop.create({ name: "B" });
  await Item.create({ title: "feat", shop_id: s1.id, featured: 1 });
  await Item.create({ title: "plain", shop_id: s2.id, featured: 0 });

  const rows = await Shop.withWhereHas("items", (q) => {
    q.where("featured", 1);
  }).get();
  expect(rows.count()).toBe(1);
  expect(rows.first()!.name).toBe("A");
  expect(
    (rows.first() as unknown as { items: OrmCollection }).items.count(),
  ).toBeGreaterThan(0);

  await connection.close();
});
