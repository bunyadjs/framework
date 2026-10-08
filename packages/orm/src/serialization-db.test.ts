import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Attribute, Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class SeUser extends Model {
  static table = "se_users";
  static fillable = ["name", "email", "password", "born", "meta"];
  static hidden = ["password"];
  static appends = ["display"];
  static casts() {
    return { born: "date:Y-m-d" as const, meta: "json" as const };
  }
  declare id: number;
  declare name: string;
  declare email: string;
  declare password: string;
  declare meta: any;
  posts() { return this.hasMany(SePost, "user_id"); }
  profile() { return this.hasOne(SeProfile, "user_id"); }
  static display = Attribute.make({ get: (_v: unknown, attrs: Record<string, unknown>) => `${attrs.name} <${attrs.email}>` });
  getDisplayAttribute() { return `${this.name} <${this.email}>`; }
}
class SePost extends Model {
  static table = "se_posts";
  static fillable = ["user_id", "title", "secret"];
  static hidden = ["secret"];
  declare id: number;
  declare title: string;
  declare secret: string;
}
class SeProfile extends Model {
  static table = "se_profiles";
  static fillable = ["user_id", "bio", "token"];
  static visible = ["bio"];
  declare bio: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "serialization (%s)",
  (_name, driver) => {
    const c = driver.connection;
    let userId = 0;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of ["se_profiles", "se_posts", "se_users"]) await schema.dropIfExists(t);
      await schema.create("se_users", (b) => { b.id(); b.string("name"); b.string("email"); b.string("password"); b.date("born").nullable(); b.text("meta").nullable(); b.timestamps(); });
      await schema.create("se_posts", (b) => { b.id(); b.integer("user_id"); b.string("title"); b.string("secret").nullable(); b.timestamps(); });
      await schema.create("se_profiles", (b) => { b.id(); b.integer("user_id"); b.string("bio"); b.string("token").nullable(); b.timestamps(); });
      const u = (await SeUser.create({ name: "Ada", email: "ada@x.io", password: "pw", born: new Date("1990-04-05T00:00:00Z"), meta: { a: 1 } })) as SeUser;
      userId = u.id;
      await SePost.create({ user_id: u.id, title: "p1", secret: "s1" });
      await SePost.create({ user_id: u.id, title: "p2", secret: "s2" });
      await SeProfile.create({ user_id: u.id, bio: "hello", token: "tok" });
    });
    afterAll(async () => {
      const schema = schemaFor(c);
      for (const t of ["se_profiles", "se_posts", "se_users"]) await schema.dropIfExists(t);
    });
    const load = async () => (await SeUser.with("posts", "profile").find(userId)) as SeUser;

    test("hidden attributes never reach JSON.stringify output, at any depth", async () => {
      const json = JSON.parse(JSON.stringify(await load()));
      expect(json.password).toBeUndefined();
      expect(json.posts.map((p: any) => p.secret)).toEqual([undefined, undefined]);
      expect(Object.keys(json.profile)).toEqual(["bio"]); // $visible on the related model
    });

    test("toArray() and toJSON() agree with JSON.stringify", async () => {
      const u = await load();
      expect(JSON.parse(JSON.stringify(u.toArray()))).toEqual(JSON.parse(JSON.stringify(u)));
      expect(JSON.parse(JSON.stringify(u.toJSON()))).toEqual(JSON.parse(JSON.stringify(u)));
    });

    test("a date:FORMAT cast formats the serialized value", async () => {
      const json = JSON.parse(JSON.stringify(await load()));
      expect(json.born).toBe("1990-04-05");
      // Timestamps are not cast by default: SQLite stores/returns text, Postgres and MySQL return Dates (ISO).
      expect(String(json.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}[T ]/);
    });

    test("json casts serialize as objects, not strings", async () => {
      expect(JSON.parse(JSON.stringify(await load())).meta).toEqual({ a: 1 });
    });

    test("only relations that are loaded are included", async () => {
      const bare = (await SeUser.find(userId)) as SeUser;
      expect(Object.keys(bare.toArray())).not.toContain("posts");
      expect(Object.keys(JSON.parse(JSON.stringify(await load())))).toContain("posts");
    });

    test("makeHidden / makeVisible / setVisible per instance, without affecting other instances", async () => {
      const a = await load();
      const b = await load();
      a.makeHidden("email", "posts");
      b.makeVisible("password");
      const ja = JSON.parse(JSON.stringify(a));
      const jb = JSON.parse(JSON.stringify(b));
      expect([ja.email, ja.posts]).toEqual([undefined, undefined]);
      expect(jb.password).toBe("pw");
      expect(JSON.parse(JSON.stringify(await load())).password).toBeUndefined();
      const c2 = await load();
      c2.setVisible(["id", "name"]);
      expect(Object.keys(JSON.parse(JSON.stringify(c2))).sort()).toEqual(["id", "name"]);
    });

    test("append() adds an accessor to the output for one instance", async () => {
      const u = await load();
      expect(JSON.parse(JSON.stringify(u)).display).toBe("Ada <ada@x.io>");
    });

    test("collections serialize every model with its own hidden rules", async () => {
      const users = await SeUser.with("posts").get();
      const json = JSON.parse(JSON.stringify(users));
      expect(json).toHaveLength(1);
      expect(json[0].password).toBeUndefined();
      expect(json[0].posts[0].secret).toBeUndefined();
    });

    test("only() returns a subset of the model's attributes", async () => {
      const u = await load();
      expect(u.only("name", "email")).toEqual({ name: "Ada", email: "ada@x.io" });
      expect(u.only(["id", "nope"])).toEqual({ id: userId });
    });
  },
);
