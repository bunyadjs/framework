import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import {
  Model,
  clearMorphMap,
  enforceMorphMap,
  getMorphedModel,
  morphMap,
  requireMorphMap,
} from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

// Defined once: the same class name twice would (correctly) be ambiguous for name lookup.
class MmPost extends Model {
  static table = "mm_posts";
  static fillable = ["title"];
  declare id: number;
  comments() {
    return this.morphMany(MmComment, "commentable");
  }
}
class MmVideo extends Model {
  static table = "mm_videos";
  static fillable = ["title"];
  declare id: number;
  comments() {
    return this.morphMany(MmComment, "commentable");
  }
}
class MmComment extends Model {
  declare body: string;
  static table = "mm_comments";
  static fillable = ["body", "commentable_type", "commentable_id"];
  declare commentable_type: string;
  commentable() {
    return this.morphTo("commentable");
  }
}


describe.each(drivers.map((d) => [d.name, d] as const))(
  "morph map (%s)",
  (_name, driver) => {
    const tables = ["mm_comments", "mm_posts", "mm_videos"];

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      for (const t of ["mm_posts", "mm_videos"]) {
        await schema.create(t, (b) => { b.id(); b.string("title"); b.timestamps(); });
      }
      await schema.create("mm_comments", (b) => {
        b.id();
        b.string("body");
        b.string("commentable_type");
        b.integer("commentable_id");
        b.timestamps();
      });
    });
    afterEach(() => clearMorphMap());
    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("unmapped types fall back to the class name and still resolve in morphTo", async () => {
      const post = await MmPost.create({ title: "p" });
      const video = await MmVideo.create({ title: "v" });
      await post.comments().create({ body: "on post" });
      await video.comments().create({ body: "on video" });
      const rows = await MmComment.with("commentable").orderBy("id").get();
      const types = rows.all().map((c) => (c as MmComment & { commentable: Model }).commentable.constructor.name);
      expect(types.slice(-2)).toEqual(["MmPost", "MmVideo"]);
    });

    test("morphMap() reads the map and merge=false replaces it", () => {
      morphMap({ post: MmPost });
      morphMap({ video: MmVideo });
      expect(Object.keys(morphMap()).sort()).toEqual(["post", "video"]);
      morphMap({ only: MmPost }, false);
      expect(Object.keys(morphMap())).toEqual(["only"]);
      expect(getMorphedModel("only")).toBe(MmPost);
    });

    test("aliases are stored and resolved", async () => {
      morphMap({ post: MmPost, video: MmVideo });
      const post = await MmPost.create({ title: "p2" });
      await post.comments().create({ body: "aliased" });
      const c = (await MmComment.where("body", "aliased").first()) as MmComment;
      expect(c.commentable_type).toBe("post");
      const loaded = await MmComment.with("commentable").where("body", "aliased").first();
      expect((loaded as unknown as { commentable: MmPost }).commentable).toBeInstanceOf(MmPost);
    });

    test("enforceMorphMap rejects unmapped classes", async () => {
      enforceMorphMap({ post: MmPost });
      const post = await MmPost.create({ title: "p3" });
      await post.comments().create({ body: "ok" });
      const video = await MmVideo.create({ title: "v3" });
      expect(() => video.comments()).toThrow(/No morph map defined for \[MmVideo\]/);
    });

    test("requireMorphMap(false) turns enforcement off", () => {
      enforceMorphMap({ post: MmPost });
      requireMorphMap(false);
      expect(() => new MmVideo().comments()).not.toThrow();
    });

    test("an unknown stored type gives a helpful error", async () => {
      await driver.connection.run(
        "INSERT INTO mm_comments (body, commentable_type, commentable_id) VALUES ('x', 'Ghost', 1)",
      );
      await expect(MmComment.with("commentable").where("body", "x").get()).rejects.toThrow(/No morph map entry for \[Ghost\]/);
    });
  },
);

test("two different classes with one name are never resolved by name", () => {
  const make = () => {
    class Twin extends Model {
      static table = "mm_twin";
    }
    return Twin;
  };
  const A = make();
  const B = make();
  A.bootIfNotBooted();
  B.bootIfNotBooted();
  expect(getMorphedModel("Twin")).toBeUndefined();
  morphMap({ Twin: A });
  expect(getMorphedModel("Twin")).toBe(A);
  clearMorphMap();
});
