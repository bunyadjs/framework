import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class MwPost extends Model {
  static table = "mw_posts";
  static fillable = ["title"];
  declare id: number;
  comments() { return this.morphMany(MwComment, "commentable"); }
  cover() { return this.morphOne(MwComment, "commentable"); }
}
class MwVideo extends Model {
  static table = "mw_videos";
  static fillable = ["title"];
  declare id: number;
  comments() { return this.morphMany(MwComment, "commentable"); }
}
class MwComment extends Model {
  static table = "mw_comments";
  static fillable = ["commentable_type", "commentable_id", "body", "likes"];
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "whereHas / has / doesntHave on morphMany and morphOne (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["mw_comments", "mw_videos", "mw_posts"];
    beforeAll(async () => {
      Model.setConnection(c);
      morphMap({ post: MwPost, video: MwVideo });
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      for (const t of ["mw_posts", "mw_videos"]) await schema.create(t, (b) => { b.id(); b.string("title"); b.timestamps(); });
      await schema.create("mw_comments", (b) => { b.id(); b.string("commentable_type"); b.integer("commentable_id"); b.string("body"); b.integer("likes").nullable(); b.timestamps(); });
      // ids 1..3 exist in both tables so the morph type is the only thing separating them
      for (const n of ["p1", "p2", "p3"]) await MwPost.create({ title: n });
      for (const n of ["v1", "v2", "v3"]) await MwVideo.create({ title: n });
      await MwComment.create({ commentable_type: "post", commentable_id: 1, body: "on p1", likes: 5 });
      await MwComment.create({ commentable_type: "post", commentable_id: 1, body: "also p1", likes: 1 });
      await MwComment.create({ commentable_type: "video", commentable_id: 2, body: "on v2", likes: 9 });
    });
    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });
    const titles = async (q: { get(): unknown }) => ((await q.get()) as { pluck(c: string): { all(): string[] } }).pluck("title").all().sort();

    test("whereHas respects the morph type, even when ids collide across tables", async () => {
      expect(await titles(MwPost.whereHas("comments"))).toEqual(["p1"]);
      expect(await titles(MwVideo.whereHas("comments"))).toEqual(["v2"]);
    });

    test("has / doesntHave / constraint closures", async () => {
      expect(await titles(MwPost.doesntHave("comments"))).toEqual(["p2", "p3"]);
      expect(await titles(MwPost.whereHas("comments", (q) => q.where("likes", ">", 3)))).toEqual(["p1"]);
      expect(await titles(MwPost.whereHas("comments", (q) => q.where("likes", ">", 50)))).toEqual([]);
      expect(await titles(MwVideo.whereHas("comments", (q) => q.where("likes", ">", 3)))).toEqual(["v2"]);
    });

    test("morphOne works the same way", async () => {
      expect(await titles(MwPost.whereHas("cover"))).toEqual(["p1"]);
      expect(await titles(MwPost.whereRelation("comments", "body", "also p1"))).toEqual(["p1"]);
    });

    test("withCount / withExists / withSum agree with whereHas", async () => {
      const posts = await MwPost.withCount("comments").withSum("comments", "likes").withExists("comments").orderBy("id").get();
      const rows = posts.all() as any[];
      expect(rows.map((r) => Number(r.comments_count))).toEqual([2, 0, 0]);
      expect(Number(rows[0].comments_sum_likes)).toBe(6);
      expect(rows.map((r) => Number(r.comments_exists || 0))).toEqual([1, 0, 0]);
    });

    test("loadCount on an instance and an eager load by type", async () => {
      const post = (await MwPost.find(1)) as MwPost;
      await post.loadCount("comments");
      expect(Number((post as any).comments_count)).toBe(2);
      const video = (await MwVideo.with("comments").find(2)) as any;
      expect(video.comments.pluck("body").all()).toEqual(["on v2"]);
    });
  },
);
