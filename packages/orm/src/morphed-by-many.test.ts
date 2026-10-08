import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "morphedByMany (%s)",
  (_name, driver) => {
    class Post extends Model {
      static table = "mbm_posts";
      static fillable = ["title"];
      tags() {
        return this.morphToMany(Tag, "taggable", {
          table: "taggables",
          foreignPivotKey: "taggable_id",
          relatedPivotKey: "mbm_tag_id",
          morphTypeColumn: "taggable_type",
          morphTypes: ["post"],
        });
      }
    }
    class Video extends Model {
      static table = "mbm_videos";
      static fillable = ["title"];
    }
    class Tag extends Model {
      static table = "mbm_tags";
      static fillable = ["name"];
      posts() {
        return this.morphedByMany(Post, "taggable", "taggables", "mbm_tag_id");
      }
      videos() {
        return this.morphedByMany(Video, "taggable", "taggables", "mbm_tag_id");
      }
    }

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      morphMap({ post: Post, video: Video });
      const schema = schemaFor(driver.connection);
      for (const t of ["taggables", "mbm_posts", "mbm_videos", "mbm_tags"]) {
        await schema.dropIfExists(t);
      }
      for (const t of ["mbm_posts", "mbm_videos"]) {
        await schema.create(t, (b) => {
          b.id();
          b.string("title");
          b.timestamps();
        });
      }
      await schema.create("mbm_tags", (b) => {
        b.id();
        b.string("name");
        b.timestamps();
      });
      await schema.create("taggables", (b) => {
        b.integer("mbm_tag_id");
        b.integer("taggable_id");
        b.string("taggable_type");
      });
    });

    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(driver.connection);
      for (const t of ["taggables", "mbm_posts", "mbm_videos", "mbm_tags"]) {
        await schema.dropIfExists(t);
      }
    });

    test("get() only returns the related morph type", async () => {
      const tag = await Tag.create({ name: "php" });
      const p1 = await Post.create({ title: "P1" });
      const v1 = await Video.create({ title: "V1" });
      // Same numeric id may exist in both tables — morph type must disambiguate.
      await driver.connection.run(
        "INSERT INTO taggables (mbm_tag_id, taggable_id, taggable_type) VALUES (?, ?, ?)",
        [tag.id, p1.id, "post"],
      );
      await driver.connection.run(
        "INSERT INTO taggables (mbm_tag_id, taggable_id, taggable_type) VALUES (?, ?, ?)",
        [tag.id, v1.id, "video"],
      );
      expect((await tag.posts().get()).pluck("title").all()).toEqual(["P1"]);
      expect((await tag.videos().get()).pluck("title").all()).toEqual(["V1"]);
    });

    test("attach / detach / sync / toggle", async () => {
      const tag = await Tag.create({ name: "ts" });
      const a = await Post.create({ title: "A" });
      const b = await Post.create({ title: "B" });
      const c = await Post.create({ title: "C" });
      const ids = (rel: Promise<{ pluck(k: string): { all(): unknown[] } }>) =>
        rel.then((r) => r.pluck("title").all().sort());

      await tag.posts().attach([a.id as number, b.id as number]);
      expect(await ids(tag.posts().get())).toEqual(["A", "B"]);

      await tag.posts().sync([b.id as number, c.id as number]);
      expect(await ids(tag.posts().get())).toEqual(["B", "C"]);

      await tag.posts().syncWithoutDetaching([a.id as number, b.id as number]);
      expect(await ids(tag.posts().get())).toEqual(["A", "B", "C"]);

      await tag.posts().toggle([a.id as number, 9999]);
      await tag.posts().detach(9999);
      expect(await ids(tag.posts().get())).toEqual(["B", "C"]);

      await tag.posts().detach();
      expect((await tag.posts().get()).count()).toBe(0);
    });

    test("detach leaves other morph types untouched", async () => {
      const tag = await Tag.create({ name: "mix" });
      const p = await Post.create({ title: "PX" });
      const v = await Video.create({ title: "VX" });
      await tag.posts().attach(p.id as number);
      await tag.videos().attach(v.id as number);
      await tag.posts().detach();
      expect((await tag.posts().get()).count()).toBe(0);
      expect((await tag.videos().get()).count()).toBe(1);
    });

    test("eager load via with()", async () => {
      const t1 = await Tag.create({ name: "e1" });
      const t2 = await Tag.create({ name: "e2" });
      const p = await Post.create({ title: "EP" });
      const v = await Video.create({ title: "EV" });
      await t1.posts().attach(p.id as number);
      await t1.videos().attach(v.id as number);
      await t2.posts().attach(p.id as number);

      const tags = await Tag.with("posts", "videos")
        .whereIn("id", [t1.id, t2.id])
        .orderBy("id")
        .get();
      const [a, b] = tags.all() as unknown as Array<{
        posts: { pluck(k: string): { all(): unknown[] } };
        videos: { count(): number };
      }>;
      expect(a!.posts.pluck("title").all()).toEqual(["EP"]);
      expect(a!.videos.count()).toBe(1);
      expect(b!.posts.pluck("title").all()).toEqual(["EP"]);
      expect(b!.videos.count()).toBe(0);
    });

    test("whereHas / withCount / withSum work through the inverse relation", async () => {
      const used = await Tag.create({ name: "wh-used" });
      const unused = await Tag.create({ name: "wh-unused" });
      const p1 = await Post.create({ title: "WH1" });
      const p2 = await Post.create({ title: "WH2" });
      const v1 = await Video.create({ title: "WHV" });
      await used.posts().attach([p1.id as number, p2.id as number]);
      await used.videos().attach(v1.id as number);

      const withPosts = await Tag.whereHas("posts").whereIn("id", [used.id, unused.id]).get();
      expect(withPosts.pluck("name").all()).toEqual(["wh-used"]);

      const constrained = await Tag.whereHas("posts", (q) => q.where("title", "WH2"))
        .whereIn("id", [used.id, unused.id])
        .get();
      expect(constrained.count()).toBe(1);

      const none = await Tag.whereHas("posts", (q) => q.where("title", "nope")).whereIn("id", [used.id]).get();
      expect(none.count()).toBe(0);

      const counted = await Tag.withCount("posts", "videos").whereIn("id", [used.id, unused.id]).orderBy("id").get();
      const [a, b] = counted.all() as unknown as Array<Record<string, unknown>>;
      expect([Number(a!.posts_count), Number(a!.videos_count)]).toEqual([2, 1]);
      expect([Number(b!.posts_count), Number(b!.videos_count)]).toEqual([0, 0]);
    });

    test("default pivot naming follows Laravel", () => {
      class T2 extends Model {
        static table = "tags";
        posts() {
          return this.morphedByMany(Post, "taggable");
        }
      }
      const rel = new T2().posts();
      expect(rel.getPivotTable()).toBe("taggables");
      expect(rel.getForeignPivotKeyName()).toBe("tag_id");
      expect(rel.getRelatedPivotKeyName()).toBe("taggable_id");
      expect(rel.getMorphTypeColumn()).toBe("taggable_type");
    });
  },
);
