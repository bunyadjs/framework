import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "aggregates on through / morph / soft-deleted relations (%s)",
  (_name, driver) => {
    class Country extends Model {
      static table = "rm_countries";
      static fillable = ["name"];
      declare name: string;
      declare id: number;
      posts() {
        return this.hasManyThrough(Post, User, "country_id", "user_id");
      }
      comments() {
        return this.morphMany(Comment, "commentable");
      }
      users() {
        return this.hasMany(User, "country_id");
      }
    }
    class User extends Model {
      static table = "rm_users";
      static fillable = ["name", "country_id"];
      declare id: number;
    }
    class Post extends Model {
      static table = "rm_posts";
      static fillable = ["user_id", "views"];
      static softDeletes = true;
    }
    class Comment extends Model {
      static table = "rm_comments";
      static fillable = ["commentable_type", "commentable_id", "body"];
    }
    const tables = ["rm_comments", "rm_posts", "rm_users", "rm_countries"];
    const num = (v: unknown) => Number(v);

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      morphMap({ country: Country });
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("rm_countries", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("rm_users", (b) => { b.id(); b.string("name"); b.integer("country_id"); b.timestamps(); });
      await schema.create("rm_posts", (b) => {
        b.id();
        b.integer("user_id");
        b.integer("views");
        b.timestamps();
        b.softDeletes();
      });
      await schema.create("rm_comments", (b) => {
        b.id();
        b.string("commentable_type");
        b.integer("commentable_id");
        b.string("body");
        b.timestamps();
      });

      const pk = await Country.create({ name: "PK" });
      const us = await Country.create({ name: "US" });
      await Country.create({ name: "Empty" });
      const u1 = await User.create({ name: "u1", country_id: pk.id });
      const u2 = await User.create({ name: "u2", country_id: pk.id });
      const u3 = await User.create({ name: "u3", country_id: us.id });
      await Post.create({ user_id: u1.id, views: 10 });
      await Post.create({ user_id: u1.id, views: 20 });
      const gone = await Post.create({ user_id: u2.id, views: 1000 });
      await gone.delete(); // soft-deleted: must not be counted
      await Post.create({ user_id: u3.id, views: 5 });
      await Comment.create({ commentable_type: "country", commentable_id: pk.id, body: "a" });
      await Comment.create({ commentable_type: "country", commentable_id: pk.id, body: "b" });
      // same id, different morph type — must not count
      await Comment.create({ commentable_type: "other", commentable_id: pk.id, body: "x" });
    });

    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    const byName = (rows: { all(): unknown[] }) =>
      Object.fromEntries((rows.all() as Array<Record<string, unknown>>).map((r) => [r.name, r]));

    test("hasManyThrough count / sum, ignoring soft-deleted related rows", async () => {
      const rows = byName(await Country.withCount("posts").withSum("posts", "views").get());
      expect(num(rows.PK!.posts_count)).toBe(2);
      expect(num(rows.PK!.posts_sum_views)).toBe(30);
      expect(num(rows.US!.posts_count)).toBe(1);
      expect(num(rows.Empty!.posts_count)).toBe(0);
    });

    test("hasManyThrough with constraint", async () => {
      const rows = byName(
        await Country.withCount({ "posts as big": (q) => q.where("views", ">", 10) }).get(),
      );
      expect(num(rows.PK!.big)).toBe(1);
      expect(num(rows.US!.big)).toBe(0);
    });

    test("morphMany count respects the morph type", async () => {
      const rows = byName(await Country.withCount("comments").get());
      expect(num(rows.PK!.comments_count)).toBe(2);
      expect(num(rows.US!.comments_count)).toBe(0);
    });

    test("morphMany exists and constraint", async () => {
      const rows = byName(
        await Country.withExists("comments")
          .withCount({ "comments as only_a": (q) => q.where("body", "a") })
          .get(),
      );
      expect(num(rows.PK!.comments_exists)).toBe(1);
      expect(num(rows.PK!.only_a)).toBe(1);
    });

    test("unknown relation throws instead of silently skipping", () => {
      expect(() => Country.withCount("nope").toSql()).toThrow();
    });
  },
);
