import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class WdAuthor extends Model {
  static table = "wd_authors";
  static fillable = ["name"];
  declare id: number;
  declare name: string;
}
class WdPost extends Model {
  static table = "wd_posts";
  static fillable = ["author_id", "title"];
  declare author_id: number | null;
  declare title: string;
  declare id: number;
  author() { return this.belongsTo(WdAuthor, "author_id").withDefault({ name: "Guest Author" }); }
  plainAuthor() { return this.belongsTo(WdAuthor, "author_id"); }
  authorFn() { return this.belongsTo(WdAuthor, "author_id").withDefault((a, post) => { (a as WdAuthor).name = `for post ${(post as WdPost).title}`; }); }
  authorTrue() { return this.belongsTo(WdAuthor, "author_id").withDefault(); }
}
class WdUser extends Model {
  declare name: string;
  static table = "wd_users";
  static fillable = ["name"];
  declare id: number;
  profile() { return this.hasOne(WdProfile, "user_id").withDefault({ bio: "no bio yet" }); }
  avatar() { return this.morphOne(WdAvatar, "owner").withDefault({ url: "default.png" }); }
}
class WdProfile extends Model {
  static table = "wd_profiles";
  static fillable = ["user_id", "bio"];
  declare user_id: number;
  declare bio: string;
}
class WdAvatar extends Model {
  static table = "wd_avatars";
  static fillable = ["owner_type", "owner_id", "url"];
  declare owner_type: string;
  declare owner_id: number;
  declare url: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "withDefault (%s)",
  (_name, driver) => {
    const tables = ["wd_avatars", "wd_profiles", "wd_users", "wd_posts", "wd_authors"];
    beforeAll(async () => {
      Model.setConnection(driver.connection);
      morphMap({ user: WdUser });
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("wd_authors", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("wd_posts", (b) => { b.id(); b.integer("author_id").nullable(); b.string("title"); b.timestamps(); });
      await schema.create("wd_users", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("wd_profiles", (b) => { b.id(); b.integer("user_id"); b.string("bio"); b.timestamps(); });
      await schema.create("wd_avatars", (b) => { b.id(); b.string("owner_type"); b.integer("owner_id"); b.string("url"); b.timestamps(); });
    });
    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("belongsTo: default attributes when the foreign key is null or dangling", async () => {
      const orphan = (await WdPost.create({ title: "orphan" })) as WdPost;
      const dangling = (await WdPost.create({ title: "dangling", author_id: 9999 })) as WdPost;
      expect(((await orphan.author().first()) as WdAuthor).name).toBe("Guest Author");
      expect(((await dangling.author().first()) as WdAuthor).name).toBe("Guest Author");
      // the default is a new, unsaved model
      expect(((await orphan.author().first()) as WdAuthor).exists).toBe(false);
    });

    test("belongsTo: a real author wins over the default", async () => {
      const a = (await WdAuthor.create({ name: "Ada" })) as WdAuthor;
      const p = (await WdPost.create({ title: "real", author_id: a.id })) as WdPost;
      expect(((await p.author().first()) as WdAuthor).name).toBe("Ada");
    });

    test("belongsTo without withDefault still returns null", async () => {
      const p = (await WdPost.create({ title: "none" })) as WdPost;
      expect(await p.plainAuthor().first()).toBeNull();
    });

    test("callback and bare withDefault()", async () => {
      const p = (await WdPost.create({ title: "cb" })) as WdPost;
      expect(((await p.authorFn().first()) as WdAuthor).name).toBe("for post cb");
      const bare = (await p.authorTrue().first()) as WdAuthor;
      expect(bare).toBeInstanceOf(WdAuthor);
      expect(bare.name).toBeUndefined();
    });

    test("eager loading fills defaults only where nothing matched", async () => {
      const a = (await WdAuthor.create({ name: "Eve" })) as WdAuthor;
      await WdPost.create({ title: "e-real", author_id: a.id });
      await WdPost.create({ title: "e-orphan" });
      const posts = await WdPost.with("author").whereIn("title", ["e-real", "e-orphan"]).orderBy("title").get();
      const [orphan, real] = posts.all() as any[];
      expect(real.author.name).toBe("Eve");
      expect(orphan.author.name).toBe("Guest Author");
      expect(orphan.author.exists).toBe(false);
    });

    test("hasOne: default carries the owner's foreign key", async () => {
      const withProfile = (await WdUser.create({ name: "has" })) as WdUser;
      await WdProfile.create({ user_id: withProfile.id, bio: "real bio" });
      const without = (await WdUser.create({ name: "none" })) as WdUser;
      expect(((await withProfile.profile().first()) as WdProfile).bio).toBe("real bio");
      const d = (await without.profile().first()) as WdProfile;
      expect(d.bio).toBe("no bio yet");
      expect(d.user_id).toBe(without.id);
      const users = await WdUser.with("profile").whereIn("name", ["has", "none"]).orderBy("name").get();
      const [h, n] = users.all() as any[];
      expect([h.profile.bio, n.profile.bio]).toEqual(["real bio", "no bio yet"]);
    });

    test("morphOne: default carries the owner's type and id", async () => {
      const u = (await WdUser.create({ name: "avatarless" })) as WdUser;
      const d = (await u.avatar().first()) as WdAvatar;
      expect(d.url).toBe("default.png");
      expect(d.owner_type).toBe("user");
      expect(d.owner_id).toBe(u.id);
      const loaded = (await WdUser.with("avatar").find(u.id)) as any;
      expect(loaded.avatar.url).toBe("default.png");
    });
  },
);
