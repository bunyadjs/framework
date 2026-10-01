import { expect, test, beforeEach, afterEach } from "bun:test";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "./index.ts";

let connection: ReturnType<typeof connectSqlite>;

beforeEach(async () => {
  connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("countries", (t) => {
    t.id();
    t.string("name");
  });
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.integer("country_id");
  });
  await schema.create("posts", (t) => {
    t.id();
    t.string("title");
    t.integer("user_id");
  });
});

afterEach(() => {
  connection.close?.();
});

test("hasManyThrough lazy get and eager with", async () => {
  class Country extends Model {
    static table = "countries";
    static timestamps = false;
    static fillable = ["name"];
    posts() {
      return this.hasManyThrough(Post, User);
    }
  }
  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name", "country_id"];
  }
  class Post extends Model {
    static table = "posts";
    static timestamps = false;
    static fillable = ["title", "user_id"];
  }

  const pk = await Country.create({ name: "Pakistan" });
  const u1 = await User.create({ name: "Ada", country_id: pk.id });
  const u2 = await User.create({ name: "Grace", country_id: pk.id });
  await Post.create({ title: "A", user_id: u1.id });
  await Post.create({ title: "B", user_id: u1.id });
  await Post.create({ title: "C", user_id: u2.id });
  await User.create({ name: "Other", country_id: 999 });
  await Post.create({ title: "X", user_id: 999 });

  const lazy = await pk.posts().get();
  expect(lazy.count()).toBe(3);
  expect([...lazy.pluck("title")].sort()).toEqual(["A", "B", "C"]);

  const eager = await Country.with("posts").where("id", pk.id).first();
  expect(eager).not.toBeNull();
  const posts = (eager as unknown as { posts: { count(): number; pluck(k: string): string[] } }).posts;
  expect(posts.count()).toBe(3);
  expect([...posts.pluck("title")].sort()).toEqual(["A", "B", "C"]);
});
