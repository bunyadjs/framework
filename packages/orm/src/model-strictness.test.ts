/**
 * Model strictness, whereUuid/Ulid, withoutTouching, refreshForUpdate.
 */
import { afterEach, expect, test } from "bun:test";
import { connectSqlite, schemaFor, DB } from "@bunyad/database";
import {
  LazyLoadingViolationException,
  MassAssignmentException,
  MissingAttributeException,
  Model,
  resetModelStrictnessForTests,
} from "../src/index.ts";

afterEach(() => {
  resetModelStrictnessForTests();
});

test("shouldBeStrict: preventSilentlyDiscardingAttributes throws on discarded fill", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
  });

  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name"];
  }

  Model.shouldBeStrict(true);
  expect(() => new User().fill({ name: "Ada", admin: true })).toThrow(
    MassAssignmentException,
  );

  Model.preventSilentlyDiscardingAttributes(false);
  const u = new User().fill({ name: "Ada", admin: true });
  expect(u.getAttribute("name")).toBe("Ada");
  expect((u as unknown as Record<string, unknown>).admin).toBeUndefined();

  await connection.close();
});

test("preventLazyLoading throws on related() for existing unloaded relation", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
  });

  class Post extends Model {
    static table = "posts";
    static timestamps = false;
    static fillable = ["user_id", "title"];
  }
  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name"];
    posts() {
      return this.hasMany(Post, "user_id");
    }
  }

  const user = await User.create({ name: "Ada" });
  await Post.create({ user_id: user.id, title: "Hi" });

  Model.preventLazyLoading(true);
  expect(() => user.related("posts")).toThrow(LazyLoadingViolationException);

  const withPosts = await User.with("posts").find(user.id);
  expect(withPosts).not.toBeNull();
  expect(withPosts!.relationLoaded("posts")).toBe(true);

  Model.preventLazyLoading(false);
  const rel = user.related("posts") as { get: () => Promise<unknown> };
  const posts = await rel.get();
  expect((posts as { count: () => number }).count()).toBe(1);

  await connection.close();
});

test("preventAccessingMissingAttributes via getAttribute", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
  });

  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name"];
  }

  const user = await User.create({ name: "Ada" });
  Model.preventAccessingMissingAttributes(true);
  expect(user.getAttribute("name")).toBe("Ada");
  expect(() => user.getAttribute("missing_col")).toThrow(
    MissingAttributeException,
  );

  await connection.close();
});

test("whereUuid / whereUlid filter rows", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("items", (table) => {
    table.id();
    table.string("uuid");
    table.string("ulid");
  });

  class Item extends Model {
    static table = "items";
    static timestamps = false;
    static fillable = ["uuid", "ulid"];
  }

  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const ulid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  await Item.create({ uuid, ulid });
  await Item.create({
    uuid: "00000000-0000-0000-0000-000000000001",
    ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  });

  const byUuid = await Item.whereUuid("uuid", uuid).first();
  expect(byUuid?.getAttribute("uuid")).toBe(uuid);

  const byUlid = await Item.whereUlid("ulid", ulid).first();
  expect(byUlid?.getAttribute("ulid")).toBe(ulid);

  const qbUuid = await DB.table("items").whereUuid("uuid", uuid).first();
  expect(qbUuid?.uuid).toBe(uuid);

  await connection.close();
});

test("withoutTouching suppresses touch(); refreshForUpdate reloads", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.text("updated_at").nullable();
    table.text("created_at").nullable();
  });

  class User extends Model {
    static table = "users";
    static timestamps = true;
    static fillable = ["name"];
  }

  const user = await User.create({ name: "Ada" });
  const before = (user as unknown as Record<string, unknown>).updated_at;

  await User.withoutTouching(async () => {
    const ok = await user.touch();
    expect(ok).toBe(false);
  });
  expect((user as unknown as Record<string, unknown>).updated_at).toBe(before);

  await DB.table("users").where("id", user.id).update({ name: "Grace" });

  await user.refreshForUpdate();
  expect(user.getAttribute("name")).toBe("Grace");

  const touched = await user.touch();
  expect(touched).toBe(true);

  await connection.close();
});


test("withAttributes applies wheres and pending attrs on create", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("posts", (table) => {
    table.id();
    table.string("title");
    table.integer("hidden").default(0);
  });

  class Post extends Model {
    static table = "posts";
    static timestamps = false;
    static fillable = ["title", "hidden"];
    static scopeDraft(query: {
      withAttributes: (a: Record<string, unknown>) => unknown;
    }) {
      query.withAttributes({ hidden: 1 });
    }
  }

  const viaQuery = await Post.query()
    .withAttributes({ hidden: 1 })
    .create({ title: "WIP" });
  expect(Number(viaQuery.getAttribute("hidden"))).toBe(1);

  type DraftQ = {
    create: (a: Record<string, unknown>) => Promise<InstanceType<typeof Post>>;
    get: () => Promise<{ count: () => number }>;
  };
  const viaScope = await (
    Post.newQuery() as unknown as DraftQ & { draft: () => DraftQ }
  )
    .draft()
    .create({ title: "Also draft" });
  expect(Number(viaScope.getAttribute("hidden"))).toBe(1);

  await Post.create({ title: "Public", hidden: 0 });
  expect((await Post.all()).count()).toBe(3);
  expect(
    (
      await (Post.newQuery() as unknown as { draft: () => DraftQ }).draft().get()
    ).count(),
  ).toBe(2);

  const open = await Post.query()
    .withAttributes({ hidden: 1 }, false)
    .create({ title: "Forced hidden without where" });
  expect(Number(open.getAttribute("hidden"))).toBe(1);

  await connection.close();
});

test("forceDestroy permanently deletes soft-deleted rows", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("flights", (table) => {
    table.id();
    table.string("name");
    table.text("deleted_at").nullable();
  });

  class Flight extends Model {
    static table = "flights";
    static timestamps = false;
    static softDeletes = true;
    static fillable = ["name"];
  }

  const a = await Flight.create({ name: "A" });
  const b = await Flight.create({ name: "B" });
  await a.delete();
  expect(await Flight.withTrashed().count()).toBe(2);

  const n = await Flight.forceDestroy([a.id, b.id]);
  expect(n).toBe(2);
  expect(await Flight.withTrashed().count()).toBe(0);

  await connection.close();
});

test("$touches cascade bumps parent updated_at on save; withoutTouching honors related", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("posts", (table) => {
    table.id();
    table.string("title");
    table.text("updated_at").nullable();
    table.text("created_at").nullable();
  });
  await schema.create("comments", (table) => {
    table.id();
    table.integer("post_id");
    table.string("body");
    table.text("updated_at").nullable();
    table.text("created_at").nullable();
  });

  class Post extends Model {
    static table = "posts";
    static timestamps = true;
    static fillable = ["title"];
  }
  class Comment extends Model {
    static table = "comments";
    static timestamps = true;
    static fillable = ["post_id", "body"];
    static touches = ["post"];
    static relations = {
      post: (m: Model) => m.belongsTo(Post, "post_id"),
    };
  }

  const post = await Post.create({ title: "Hello" });
  // Seed an old parent timestamp (SQLite datetime is second resolution).
  await DB.table("posts").where("id", post.id).update({
    updated_at: "2000-01-01 00:00:00",
  });

  const comment = await Comment.create({ post_id: post.id, body: "Nice" });
  expect(comment.touches("post")).toBe(true);
  expect(comment.touches("author")).toBe(false);

  const refreshed = await Post.find(post.id);
  expect(refreshed).not.toBeNull();
  const afterCreate = String(
    (refreshed as unknown as Record<string, unknown>).updated_at,
  );
  expect(afterCreate).not.toBe("2000-01-01 00:00:00");

  await DB.table("posts").where("id", post.id).update({
    updated_at: "2000-01-01 00:00:00",
  });
  await Post.withoutTouching(async () => {
    await comment.update({ body: "Edited" });
  });
  const afterIgnore = await Post.find(post.id);
  expect(
    String((afterIgnore as unknown as Record<string, unknown>).updated_at),
  ).toBe("2000-01-01 00:00:00");

  await comment.update({ body: "Edited again" });
  const afterUpdate = await Post.find(post.id);
  expect(
    String((afterUpdate as unknown as Record<string, unknown>).updated_at),
  ).not.toBe("2000-01-01 00:00:00");

  await connection.close();
});

test("$touches cascade on soft delete", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("posts", (table) => {
    table.id();
    table.string("title");
    table.text("updated_at").nullable();
    table.text("created_at").nullable();
  });
  await schema.create("comments", (table) => {
    table.id();
    table.integer("post_id");
    table.string("body");
    table.text("updated_at").nullable();
    table.text("created_at").nullable();
    table.text("deleted_at").nullable();
  });

  class Post extends Model {
    static table = "posts";
    static timestamps = true;
    static fillable = ["title"];
  }
  class Comment extends Model {
    static table = "comments";
    static timestamps = true;
    static softDeletes = true;
    static fillable = ["post_id", "body"];
    static touches = ["post"];
    static relations = {
      post: (m: Model) => m.belongsTo(Post, "post_id"),
    };
  }

  const post = await Post.create({ title: "Hello" });
  const comment = await Comment.create({ post_id: post.id, body: "Bye" });
  await DB.table("posts").where("id", post.id).update({
    updated_at: "2000-01-01 00:00:00",
  });

  await comment.delete();

  const after = await Post.find(post.id);
  expect(
    String((after as unknown as Record<string, unknown>).updated_at),
  ).not.toBe("2000-01-01 00:00:00");

  await connection.close();
});
