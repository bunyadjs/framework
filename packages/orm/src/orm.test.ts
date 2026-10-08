import { expect, test } from "bun:test";
import { runWithPaginatorRequest } from "@bunyad/common";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Factory, HasMany, Model, ModelQuery, OrmCollection, Pivot, UseBuilder, collect, fake } from "../src/index.ts";

class User extends Model {
  declare name: string;
  declare email: string;
  declare created_at: unknown;
  declare updated_at: unknown;
  static table = "users";

  static factory() {
    return new UserFactory();
  }

  posts() {
    return this.hasMany(Post);
  }
}

class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  definition() {
    userFactorySequence += 1;
    return {
      name: `User ${userFactorySequence}`,
      email: `user-${userFactorySequence}@example.com`,
    };
  }
}

let userFactorySequence = 0;

type Expect<T extends true> = T;
type _userFactoryAssignable = Expect<UserFactory extends Factory<any> ? true : false>;
type _userCreateThis = Expect<typeof User extends typeof Model ? true : false>;

class Post extends Model {
  declare title: string;
  declare user_id: string | number;
  static table = "posts";

  user() {
    return this.belongsTo(User);
  }
}

test("model find create where save", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const created = (await User.create({ email: "a@b.c", name: "Ada" })) as User;
  expect(created.id).toBe(1);
  expect((await User.find(1))?.name).toBe("Ada");
  expect((await User.where("email", "a@b.c").first())?.name).toBe("Ada");

  const user = (await User.find(1))!;
  user.name = "Ada Lovelace";
  await user.save();
  expect((await User.find(1))?.name).toBe("Ada Lovelace");

  await connection.close();
});

test("sqlite find and create are synchronous without listeners or casts", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("name");
  });

  class Item extends Model {
    declare name: string;
    static table = "users";
    static timestamps = false;
    static fillable = ["name"] as const;
  }

  const created = Item.create({ name: "Ada" });
  expect(created instanceof Promise).toBe(false);
  expect((created as Item).id).toBe(1);
  expect((created as Item).wasRecentlyCreated()).toBe(true);

  const found = Item.find(1);
  expect(found instanceof Promise).toBe(false);
  expect((found as Item).name).toBe("Ada");

  (found as Item).name = "Ada Lovelace";
  const saved = (found as Item).save();
  expect(saved instanceof Promise).toBe(false);
  expect((Item.find(1) as Item).name).toBe("Ada Lovelace");

  await connection.close();
});

test("hasMany and belongsTo", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.timestamps();
  });

  const user = (await User.create({ name: "Ada" })) as User;
  await user.posts().create({ title: "First" });
  await user.posts().create({ title: "Second" });

  expect(await user.posts().get()).toHaveLength(2);
  const post = (await Post.where("title", "First").first()) as Post;
  expect((await post.user().first())?.name).toBe("Ada");

  await connection.close();
});

test("relation query chain where orderBy get", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.timestamps();
  });

  const user = (await User.create({ name: "Ada" })) as User;
  await user.posts().create({ title: "Alpha" });
  await user.posts().create({ title: "Beta" });
  await user.posts().create({ title: "Gamma" });

  const filtered = await user.posts().where("title", "Beta").get();
  expect(filtered).toHaveLength(1);
  expect(filtered.all()[0]?.title).toBe("Beta");

  const ordered = await user.posts().orderBy("title", "desc").limit(2).get();
  expect(ordered.map((p) => p.title).all()).toEqual(["Gamma", "Beta"]);

  expect(await user.posts().where("title", "like", "%a%").count()).toBe(3);
  expect((await postBelongsToChain(user))).toBe("Ada");

  await connection.close();
});

async function postBelongsToChain(user: User): Promise<string | undefined> {
  const post = (await Post.where("title", "Alpha").first()) as Post;
  return (await post.user().where("name", "Ada").first())?.name;
}

test("constrained eager load with callback", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.boolean("published").default(false);
    table.timestamps();
  });

  const user = (await User.create({ name: "Ada" })) as User;
  await user.posts().create({ title: "Draft", published: false });
  await user.posts().create({ title: "Live", published: true });

  const loaded = (await User.with({
    posts: (q: { where: (c: string, v: unknown) => unknown }) =>
      q.where("published", true),
  }).find(user.id!)) as User & { posts: OrmCollection<Post> };

  expect(loaded.posts).toHaveLength(1);
  expect(loaded.posts.all()[0]?.title).toBe("Live");

  const all = (await User.with("posts").find(user.id!)) as User & {
    posts: OrmCollection<Post>;
  };
  expect(all.posts).toHaveLength(2);

  await connection.close();
});

test("belongsToMany withPivot hydrates pivot attributes", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("roles", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("role_user", (t) => {
    t.integer("user_id");
    t.integer("role_id");
    t.string("active");
  });

  class Role extends Model {
    static table = "roles";
    declare name: string;
    declare pivot?: Record<string, unknown>;
  }

  class Member extends Model {
    static table = "users";
    declare name: string;
    roles() {
      return this.belongsToMany(Role).withPivot("active");
    }
  }

  const user = (await Member.create({ name: "Ada" })) as Member;
  const role = (await Role.create({ name: "admin" })) as Role;
  await connection.run(
    "INSERT INTO role_user (user_id, role_id, active) VALUES (?, ?, ?)",
    [user.id, role.id, "yes"],
  );

  const roles = await user.roles().get();
  expect(roles).toHaveLength(1);
  expect(roles.all()[0]?.pivot?.active).toBe("yes");
  expect(roles.all()[0]?.pivot?.user_id).toBe(user.id);
  expect(roles.all()[0]?.pivot?.role_id).toBe(role.id);

  const eager = (await Member.with("roles").where("id", user.id).first()) as Member & {
    roles: OrmCollection<Role>;
  };
  expect(eager.roles.all()[0]?.pivot?.active).toBe("yes");

  await connection.close();
});

test("save after eager load does not persist relations as columns", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.timestamps();
  });

  const created = (await User.create({ name: "Ada" })) as User;
  await created.posts().create({ title: "First" });

  const loaded = (await User.with("posts").find(created.id!)) as User;
  expect(loaded.relationLoaded("posts")).toBe(true);
  loaded.name = "Ada Lovelace";
  (loaded as unknown as { salesReturns: User[] }).salesReturns = [loaded];
  await loaded.save();

  expect((await User.find(created.id!))?.name).toBe("Ada Lovelace");
  expect(await created.posts().get()).toHaveLength(1);

  await connection.close();
});

test("model paginate", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });

  for (let i = 1; i <= 5; i++) {
    await User.create({ name: `User${i}` });
  }

  const page1 = await User.paginate(2, 1, { path: "/users" });
  expect(page1.items).toHaveLength(2);
  expect(page1.total).toBe(5);
  expect(page1.lastPage()).toBe(3);
  expect(page1.meta().current_page).toBe(1);

  const page2 = await User.where("name", "User3").paginate(15, 1);
  expect(page2.items).toHaveLength(1);
  expect(page2.total).toBe(1);

  const fromQuery = await runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/users",
      query: () => ({ page: "2" }),
      input: (key) => (key === "page" ? "2" : undefined),
    },
    () => User.paginate(2),
  );
  expect(fromQuery.currentPage).toBe(2);
  expect(fromQuery.items.map((row) => row.name)).toEqual(["User3", "User4"]);

  await connection.close();
});

test("SQLite getSync / firstSync / findSync / allSync", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });

  await User.create({ name: "Ada" });
  await User.create({ name: "Bob" });

  const all = User.allSync();
  expect(all).toBeInstanceOf(OrmCollection);
  expect(all.pluck("name").sort().all()).toEqual(["Ada", "Bob"]);

  const ada = User.where("name", "Ada").firstSync();
  expect(ada?.name).toBe("Ada");
  expect(User.findSync(ada!.id!)?.name).toBe("Ada");
  expect(User.findSync(99999)).toBeNull();

  expect(() => User.with("posts").getSync()).toThrow(/with\(\)/);

  await connection.close();
});

test("search orderBySql and nested where callback", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("name");
    table.string("email");
    table.timestamps();
  });

  await User.create({ name: "Ada", email: "ada@x.test" });
  await User.create({ name: "Bob", email: "bob@x.test" });

  const bySearch = await User.search(["name", "email"], "ada").get();
  expect(bySearch.pluck("name").all()).toEqual(["Ada"]);

  const nested = await User.where((q) => {
    q.where("name", "Bob").orWhere("email", "like", "%ada%");
  }).get();
  expect(nested.pluck("name").sort().all()).toEqual(["Ada", "Bob"]);

  const ordered = await User.orderBySql("name desc").get();
  expect(ordered.pluck("name").all()).toEqual(["Bob", "Ada"]);

  await connection.close();
});

test("nested whereNull orWhere like keeps both branches", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("journals", (table) => {
    table.id();
    table.string("description").nullable();
    table.integer("reversed_id").nullable();
    table.integer("account_id");
    table.timestamps();
  });

  class Journal extends Model {
    static table = "journals";
    declare description: string | null;
    declare reversed_id: number | null;
    declare account_id: number;
  }

  await Journal.create({
    description: "Cash sale",
    reversed_id: null,
    account_id: 1,
  });
  await Journal.create({
    description: "Receipt adjustment - till",
    reversed_id: null,
    account_id: 1,
  });
  await Journal.create({
    description: "Other account",
    reversed_id: null,
    account_id: 2,
  });

  const rows = await Journal.where((q) => {
    q.where("account_id", 1);
  })
    .where((q) => {
      q.whereNull("reversed_id").orWhere(
        "description",
        "like",
        "Receipt adjustment - %",
      );
    })
    .get();

  expect(rows.pluck("description").sort().all()).toEqual([
    "Cash sale",
    "Receipt adjustment - till",
  ]);

  await connection.close();
});

test("soft deletes hide restore and forceDelete", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("posts", (table) => {
    table.id();
    table.string("title");
    table.text("deleted_at").nullable();
    table.timestamps();
  });

  class SoftPost extends Model {
    static table = "posts";
    static softDeletes = true;
    declare title: string;
  }

  const post = (await SoftPost.create({ title: "Draft" })) as SoftPost;
  expect(await SoftPost.all()).toHaveLength(1);

  await post.delete();
  expect(await SoftPost.all()).toHaveLength(0);
  expect(await SoftPost.withTrashed().get()).toHaveLength(1);
  expect(await SoftPost.onlyTrashed().get()).toHaveLength(1);
  expect(post.trashed()).toBe(true);

  await post.restore();
  expect(await SoftPost.all()).toHaveLength(1);
  expect(post.trashed()).toBe(false);

  await post.forceDelete();
  expect(await SoftPost.withTrashed().get()).toHaveLength(0);

  await connection.close();
});

test("factory make and create", async () => {
  userFactorySequence = 0;
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const draft = (await User.factory().make({ name: "Draft" })) as User;
  expect(draft.id).toBeUndefined();
  expect(draft.name).toBe("Draft");
  expect(await User.all()).toHaveLength(0);

  const user = (await User.factory().create()) as User;
  expect(user.id).toBe(1);
  expect(user.email).toBe("user-2@example.com");

  const many = (await User.factory().count(3).create()) as User[];
  expect(many).toHaveLength(3);
  expect(await User.all()).toHaveLength(4);

  await connection.close();
});

test("firstOrCreate and updateOrCreate", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const a = (await User.firstOrCreate(
    { email: "a@b.c" },
    { name: "Ada" },
  )) as User;
  expect(a.id).toBe(1);
  expect(a.name).toBe("Ada");

  const same = (await User.firstOrCreate(
    { email: "a@b.c" },
    { name: "Ignored" },
  )) as User;
  expect(same.id).toBe(1);
  expect(same.name).toBe("Ada");
  expect(await User.all()).toHaveLength(1);

  const draft = (await User.firstOrNew(
    { email: "new@b.c" },
    { name: "New" },
  )) as User;
  expect(draft.id).toBeUndefined();
  expect(draft.name).toBe("New");

  const updated = (await User.updateOrCreate(
    { email: "a@b.c" },
    { name: "Ada Lovelace" },
  )) as User;
  expect(updated.id).toBe(1);
  expect((await User.find(1))?.name).toBe("Ada Lovelace");

  const created = (await User.updateOrCreate(
    { email: "b@c.d" },
    { name: "Bob" },
  )) as User;
  expect(created.id).toBe(2);
  expect(await User.all()).toHaveLength(2);

  await connection.close();
});

test("Model.insert writes many rows in one statement and stamps timestamps", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const ok = await User.insert([
    { email: "a@ex.com", name: "Ada" },
    { email: "b@ex.com", name: "Grace" },
  ]);
  expect(ok).toBe(true);
  expect(await User.newQuery().count()).toBe(2);
  const ada = (await User.where("email", "a@ex.com").first()) as User;
  expect(ada.name).toBe("Ada");
  expect(ada.created_at).toBeTruthy();
  expect(ada.updated_at).toBeTruthy();

  await connection.close();
});

test("Model.upsert inserts and updates on unique conflict", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const inserted = await User.upsert(
    [
      { email: "u1@ex.com", name: "One" },
      { email: "u2@ex.com", name: "Two" },
    ],
    "email",
    ["name"],
  );
  expect(inserted).toBeGreaterThanOrEqual(2);
  expect(await User.newQuery().count()).toBe(2);
  const one = (await User.where("email", "u1@ex.com").first()) as User;
  expect(one.name).toBe("One");
  expect(one.created_at).toBeTruthy();
  expect(one.updated_at).toBeTruthy();

  const affected = await User.upsert(
    { email: "u1@ex.com", name: "One Updated" },
    "email",
    ["name"],
  );
  expect(affected).toBeGreaterThanOrEqual(1);
  const refreshed = (await User.where("email", "u1@ex.com").first()) as User;
  expect(refreshed.name).toBe("One Updated");
  expect(await User.newQuery().count()).toBe(2);

  await connection.close();
});

test("casts and hidden toArray", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("profiles", (table) => {
    table.id();
    table.string("name");
    table.integer("active");
    table.text("meta");
    table.text("secret");
    table.timestamps();
  });

  class Profile extends Model {
    static table = "profiles";
    static casts = {
      active: "boolean" as const,
      meta: "json" as const,
    };
    static hidden = ["secret"];
    declare name: string;
    declare active: boolean;
    declare meta: { theme: string };
    declare secret?: string;
  }

  const created = (await Profile.create({
    name: "Ada",
    active: true,
    meta: { theme: "dark" },
    secret: "shh",
  })) as Profile;

  expect(created.active).toBe(true);
  expect(created.meta).toEqual({ theme: "dark" });

  const raw = await connection.get<{ active: number; meta: string }>(
    "SELECT active, meta FROM profiles WHERE id = 1",
  );
  expect(raw?.active).toBe(1);
  expect(raw?.meta).toBe('{"theme":"dark"}');

  const json = created.toArray();
  expect(json.secret).toBeUndefined();
  expect(json.name).toBe("Ada");
  expect(json.active).toBe(true);

  created.makeVisible("secret");
  expect(created.toArray().secret).toBe("shh");
  created.makeHidden("name");
  expect(created.toArray().name).toBeUndefined();

  class PublicProfile extends Model {
    static table = "profiles";
    static visible = ["name", "active"];
    static hidden = [] as string[];
    declare name: string;
    declare active: boolean;
    declare secret?: string;
  }
  const pub = new PublicProfile({
    name: "Ada",
    active: true,
    secret: "nope",
  });
  expect(pub.toArray()).toEqual({ name: "Ada", active: true });

  await connection.close();
});

test("incrementing int primary key hydrates as a number", () => {
  class Item extends Model {
    static table = "items";
    declare name: string;
  }

  const row = Item.newFromBuilder({ id: "144", name: "Widget" });
  expect(row.id).toBe(144);
  expect(typeof row.id).toBe("number");
  expect(row.toArray().id).toBe(144);

  const fromBigint = Item.newFromBuilder({ id: 145n, name: "Gadget" });
  expect(fromBigint.id).toBe(145);
  expect(fromBigint.toArray().id).toBe(145);
});

test("uuid primary keys stay strings", async () => {
  const { HasUuids } = await import("../src/index.ts");

  @HasUuids()
  class Article extends Model {
    static table = "articles";
    declare title: string;
  }

  const row = Article.newFromBuilder({
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Hi",
  });
  expect(row.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  expect(typeof row.id).toBe("string");
});

test("explicit bigint id cast is preserved", () => {
  class Row extends Model {
    static table = "rows";
    static casts() {
      return { id: "bigint" as const };
    }
  }

  const row = Row.newFromBuilder({ id: "144" });
  expect(row.id as unknown).toBe(144n);
});

test("incrementing int id is numeric even when other casts exist", () => {
  class Tagged extends Model {
    static table = "tagged";
    static casts() {
      return { order: "number" as const };
    }
    declare name: string;
    declare order: number;
  }

  const row = Tagged.newFromBuilder({ id: "144", name: "X", order: "0" });
  expect(row.id).toBe(144);
  expect(typeof row.id).toBe("number");
  expect(row.order).toBe(0);
  expect(row.toArray().id).toBe(144);
});

test("boolean set-casts parse string 0/false for sqlite", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);

  class Flag extends Model {
    static table = "flags";
    static casts = { active: "boolean" as const };
  }

  expect(Flag.castAttributes({ active: "0" }, "set")).toEqual({ active: 0 });
  expect(Flag.castAttributes({ active: "false" }, "set")).toEqual({
    active: 0,
  });
  expect(Flag.castAttributes({ active: "1" }, "set")).toEqual({ active: 1 });
  expect(Flag.castAttributes({ active: 0 }, "get")).toEqual({
    active: false,
  });

  await connection.close();
});

test("findOrFail firstOrFail hasOne belongsToMany with eager load", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("profiles", (t) => {
    t.id();
    t.integer("user_id");
    t.string("bio");
    t.timestamps();
  });
  await schema.create("roles", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("role_user", (t) => {
    t.integer("user_id");
    t.integer("role_id");
  });

  class Profile extends Model {
    static table = "profiles";
    declare bio: string;
    declare user_id: number;
  }

  class Role extends Model {
    static table = "roles";
    declare name: string;
  }

  class Member extends Model {
    static table = "users";
    declare name: string;
    profile() {
      return this.hasOne(Profile);
    }
    roles() {
      return this.belongsToMany(Role);
    }
  }

  const user = (await Member.create({ name: "Ada" })) as Member;
  await user.profile().create({ bio: "Math" });
  const role = (await Role.create({ name: "admin" })) as Role;
  await user.roles().attach(role.id);

  expect((await user.profile().first())?.bio).toBe("Math");
  expect(await user.roles().get()).toHaveLength(1);

  const loaded = await Member.with("profile", "roles").where("id", user.id).first();
  expect((loaded as Member & { profile: Profile }).profile.bio).toBe("Math");
  expect(((loaded as Member & { roles: Role[] }).roles)[0]?.name).toBe("admin");

  await expect(Member.findOrFail(999)).rejects.toBeInstanceOf(
    (await import("../src/model.ts")).ModelNotFoundException,
  );
  await expect(Member.where("id", 999).firstOrFail()).rejects.toThrow();

  await connection.close();
});

test("morphMany morphTo morphOne with eager load", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("posts", (t) => {
    t.id();
    t.string("title");
    t.timestamps();
  });
  await schema.create("videos", (t) => {
    t.id();
    t.string("title");
    t.timestamps();
  });
  await schema.create("comments", (t) => {
    t.id();
    t.morphs("commentable");
    t.string("body");
    t.timestamps();
  });
  await schema.create("images", (t) => {
    t.id();
    t.nullableMorphs("imageable");
    t.string("url");
    t.timestamps();
  });

  class Post extends Model {
    static table = "posts";
    declare title: string;
    comments() {
      return this.morphMany(Comment, "commentable");
    }
    image() {
      return this.morphOne(Image, "imageable");
    }
  }

  class Video extends Model {
    static table = "videos";
    declare title: string;
    comments() {
      return this.morphMany(Comment, "commentable");
    }
  }

  class Comment extends Model {
    static table = "comments";
    declare body: string;
    declare commentable_type: string;
    declare commentable_id: number;
    commentable() {
      return this.morphTo("commentable");
    }
  }

  class Image extends Model {
    static table = "images";
    declare url: string;
  }

  const { morphMap, clearMorphMap } = await import("../src/model.ts");
  clearMorphMap();
  morphMap({ posts: Post, videos: Video });

  const post = (await Post.create({ title: "Hello" })) as Post;
  const video = (await Video.create({ title: "Watch" })) as Video;
  await post.comments().create({ body: "on post" });
  await video.comments().create({ body: "on video" });
  await post.image().create({ url: "/a.png" });

  expect(await post.comments().get()).toHaveLength(1);
  expect((await post.comments().first())?.body).toBe("on post");
  expect(await video.comments().get()).toHaveLength(1);
  expect((await post.image().first())?.url).toBe("/a.png");

  const comment = (await Comment.where("body", "on post").first()) as Comment;
  const parent = await comment.commentable().first();
  expect(parent).toBeInstanceOf(Post);
  expect((parent as Post).title).toBe("Hello");

  const loaded = await Post.with("comments", "image").where("id", post.id).first();
  expect(
    (loaded as Post & { comments: Comment[] }).comments[0]?.body,
  ).toBe("on post");
  expect((loaded as Post & { image: Image }).image.url).toBe("/a.png");

  clearMorphMap();
  await connection.close();
});

test("collect OrmCollection load and loadMissing", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("posts", (t) => {
    t.id();
    t.integer("user_id");
    t.string("title");
    t.timestamps();
  });

  class Post extends Model {
    static table = "posts";
    declare title: string;
  }

  class User extends Model {
    static table = "users";
    declare name: string;
    posts() {
      return this.hasMany(Post);
    }
  }

  const user = (await User.create({ name: "Ada" })) as User;
  await user.posts().create({ title: "One" });
  await user.posts().create({ title: "Two" });

  const all = await User.all();
  expect(all).toBeInstanceOf(OrmCollection);
  expect(all.pluck("name").all()).toEqual(["Ada"]);
  expect(all.find(user.id)?.name).toBe("Ada");
  expect(all.find([user.id]).count()).toBe(1);
  expect(collect([1, 2, 3]).sum()).toBe(6);

  const fresh = (await User.find(user.id)) as User;
  expect(fresh.relationLoaded("posts")).toBe(false);
  await fresh.load("posts");
  expect(fresh.relationLoaded("posts")).toBe(true);
  expect(
    ((fresh as unknown as { posts: OrmCollection<Post> }).posts).pluck(
      "title",
    ).all(),
  ).toEqual(["One", "Two"]);

  const again = (await User.find(user.id)) as User;
  expect(again.relationLoaded("posts")).toBe(false);
  await again.loadMissing("posts");
  expect(again.relationLoaded("posts")).toBe(true);
  expect(
    (again as unknown as { posts: OrmCollection<Post> }).posts,
  ).toHaveLength(2);
  await again.loadMissing("posts");

  await connection.close();
});

test("static relations + declare property access after with()", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("authors", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("books", (t) => {
    t.id();
    t.integer("author_id");
    t.string("title");
    t.timestamps();
  });

  class Author extends Model {
    static table = "authors";
    declare name: string;
    declare books: OrmCollection<Book>;
    static relations = {
      books: (m: Author) => m.hasMany(Book, "author_id"),
    };
  }

  class Book extends Model {
    static table = "books";
    declare title: string;
    declare author_id: number;
    declare author: Author | null;
    static relations = {
      author: (m: Book) => m.belongsTo(Author, "author_id"),
    };
  }

  const author = (await Author.create({ name: "Ada" })) as Author;
  await (author.related("books") as HasMany<Book>).create({ title: "Notes" });

  const loaded = (await Book.with("author").first()) as Book;
  expect(loaded.relationLoaded("author")).toBe(true);
  expect(loaded.author?.name).toBe("Ada");
  const { BelongsTo } = await import("../src/index.ts");
  expect(loaded.related("author")).toBeInstanceOf(BelongsTo);

  await connection.close();
});

test("get() returns models; rows() returns plain data", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("authors", (t) => {
    t.id();
    t.string("name");
    t.timestamps();
  });
  await schema.create("books", (t) => {
    t.id();
    t.integer("author_id").nullable();
    t.string("title");
    t.timestamps();
  });

  class Author extends Model {
    static table = "authors";
    declare name: string;
    static relations = {
      books: (m: Author) => m.hasMany(Book, "author_id"),
    };
  }

  class Book extends Model {
    static table = "books";
    declare title: string;
    declare author_id: number | null;
    declare author: Author | null;
    static relations = {
      author: (m: Book) => m.belongsTo(Author, "author_id"),
    };
  }

  const author = (await Author.create({ name: "Ada" })) as Author;
  await Book.create({ title: "Notes", author_id: author.id });

  const partial = await Book.with("author")
    .select("id", "title")
    .orderBy("id")
    .get();
  const first = partial.first() as Book;
  expect(first).toBeInstanceOf(Book);
  expect(first.title).toBe("Notes");
  expect(first.author).toBeNull();

  const raw = await Book.rows()
    .with("author")
    .select("id", "title")
    .orderBy("id")
    .get();
  expect(Array.isArray(raw)).toBe(true);
  expect(raw[0]).not.toBeInstanceOf(Book);
  expect(raw).toEqual([
    { id: Number(author.id), title: "Notes", author: null },
  ]);

  const full = await Book.with("author").orderBy("id").get();
  const loaded = full.first() as Book;
  expect(loaded).toBeInstanceOf(Book);
  expect(loaded.author?.name).toBe("Ada");

  await connection.close();
});

test("casts() method enum and Attribute.make", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("servers", (table) => {
    table.id();
    table.string("name");
    table.string("status");
    table.integer("price_cents");
    table.text("tags");
    table.timestamps();
  });

  const Status = {
    Ready: "ready",
    Pending: "pending",
  } as const;

  const { Attribute, collect } = await import("../src/index.ts");

  class Server extends Model {
    static table = "servers";
    static casts() {
      return {
        status: Status,
        price: Attribute.make({
          get: (_value, attributes) =>
            Number(attributes.price_cents ?? 0) / 100,
          set: (value) => ({
            price_cents: Math.round(Number(value) * 100),
          }),
        }),
        tags: "collection" as const,
      };
    }
    declare name: string;
    declare status: string;
    declare price: number;
    declare price_cents: number;
    declare tags: import("@bunyad/common").Collection<string>;
  }

  const created = (await Server.create({
    name: "web-1",
    status: Status.Ready,
    price: 19.99,
    tags: collect(["a", "b"]),
  })) as Server;

  expect(created.status).toBe("ready");
  expect(created.price).toBe(19.99);
  expect(created.tags.all()).toEqual(["a", "b"]);

  const raw = await connection.get<{
    status: string;
    price_cents: number;
    tags: string;
  }>("SELECT status, price_cents, tags FROM servers WHERE id = 1");
  expect(raw?.status).toBe("ready");
  expect(raw?.price_cents).toBe(1999);
  expect(raw?.tags).toBe('["a","b"]');

  const loaded = (await Server.find(1)) as Server;
  expect(loaded.status).toBe("ready");
  expect(loaded.price).toBe(19.99);
  expect(loaded.tags.all()).toEqual(["a", "b"]);

  loaded.status = Status.Pending;
  loaded.price = 10;
  await loaded.save();
  const raw2 = await connection.get<{ status: string; price_cents: number }>(
    "SELECT status, price_cents FROM servers WHERE id = 1",
  );
  expect(raw2?.status).toBe("pending");
  expect(raw2?.price_cents).toBe(1000);

  await connection.close();
});

test("model boot booted and lifecycle events", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("articles", (table) => {
    table.id();
    table.string("title");
    table.timestamps();
  });
  await schemaFor(connection).create("notes", (table) => {
    table.id();
    table.string("body");
    table.text("deleted_at").nullable();
    table.timestamps();
  });

  const log: string[] = [];

  class Article extends Model {
    static table = "articles";
    static fillable = ["title"];
    declare title: string;

    static boot(): void {
      log.push("boot");
    }

    static booted(): void {
      log.push("booted");
      Article.creating((m) => {
        log.push(`creating:${(m as Article).title}`);
      });
      Article.created((m) => {
        log.push(`created:${m.id}`);
      });
      Article.updating(() => {
        log.push("updating");
      });
      Article.updated(() => {
        log.push("updated");
      });
      Article.saving(() => {
        log.push("saving");
      });
      Article.saved(() => {
        log.push("saved");
      });
      Article.deleting(() => {
        log.push("deleting");
      });
      Article.deleted(() => {
        log.push("deleted");
      });
      Article.retrieved(() => {
        log.push("retrieved");
      });
    }
  }

  class ArticleObserver {
    created(model: Article) {
      log.push(`observer:created:${model.title}`);
    }
  }

  Article.observe(ArticleObserver);

  const article = (await Article.create({ title: "Hello" })) as Article;
  expect(article.id).toBe(1);
  expect(log[0]).toBe("boot");
  expect(log[1]).toBe("booted");
  expect(log).toContain("saving");
  expect(log).toContain("creating:Hello");
  expect(log).toContain("created:1");
  expect(log).toContain("saved");
  expect(log).toContain("observer:created:Hello");

  log.length = 0;
  article.title = "World";
  await article.save();
  expect(log).toEqual(["saving", "updating", "updated", "saved"]);

  log.length = 0;
  const found = await Article.find(1);
  expect(found?.title).toBe("World");
  expect(log).toEqual(["retrieved"]);

  log.length = 0;
  await article.delete();
  expect(log).toEqual(["deleting", "deleted"]);
  expect(await Article.find(1)).toBeNull();

  class Blocked extends Model {
    static table = "articles";
    static fillable = ["title"];
    declare title: string;
    static booted(): void {
      Blocked.creating(() => false);
    }
  }
  const blocked = new Blocked({ title: "nope" });
  await blocked.save();
  expect(blocked.id).toBeUndefined();
  expect(
    (await connection.get<{ c: number }>("SELECT COUNT(*) as c FROM articles"))
      ?.c,
  ).toBe(0);

  const quietLog: string[] = [];
  class Quiet extends Model {
    static table = "articles";
    static fillable = ["title"];
    declare title: string;
    static booted(): void {
      Quiet.created(() => {
        quietLog.push("created");
      });
    }
  }
  await Quiet.withoutEvents(async () => {
    await Quiet.create({ title: "silent" });
  });
  expect(quietLog).toEqual([]);
  const q = new Quiet({ title: "quiet-save" });
  await q.saveQuietly();
  expect(quietLog).toEqual([]);
  await Quiet.create({ title: "loud" });
  expect(quietLog).toEqual(["created"]);

  const softLog: string[] = [];
  class Note extends Model {
    static table = "notes";
    static softDeletes = true;
    static fillable = ["body"];
    declare body: string;
    static booted(): void {
      Note.deleting(() => {
        softLog.push("deleting");
      });
      Note.deleted(() => {
        softLog.push("deleted");
      });
      Note.trashed(() => {
        softLog.push("trashed");
      });
      Note.restoring(() => {
        softLog.push("restoring");
      });
      Note.restored(() => {
        softLog.push("restored");
      });
      Note.forceDeleting(() => {
        softLog.push("forceDeleting");
      });
      Note.forceDeleted(() => {
        softLog.push("forceDeleted");
      });
    }
  }

  const note = (await Note.create({ body: "n1" })) as Note;
  await note.delete();
  expect(softLog).toEqual(["deleting", "trashed", "deleted"]);
  expect(note.trashed()).toBe(true);

  softLog.length = 0;
  await note.restore();
  expect(softLog).toEqual(["restoring", "restored"]);
  expect(note.trashed()).toBe(false);

  softLog.length = 0;
  await note.forceDelete();
  expect(softLog).toContain("forceDeleting");
  expect(softLog).toContain("forceDeleted");
  expect(softLog).toContain("deleted");

  await connection.close();
});

test("UseBuilder swaps ModelQuery subclass", async () => {
  class PostQuery extends ModelQuery {
    titled(title: string) {
      return this.where("title", title);
    }
  }

  @UseBuilder(PostQuery)
  class BuiltPost extends Model {
    declare title: string;
    static table = "built_posts";
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("built_posts", (table) => {
    table.id();
    table.string("title");
    table.timestamps();
  });

  await BuiltPost.create({ title: "alpha" });
  await BuiltPost.create({ title: "beta" });

  const q = BuiltPost.newQuery();
  expect(q).toBeInstanceOf(PostQuery);
  const hit = await (q as unknown as PostQuery).titled("beta").first();
  expect((hit as BuiltPost | null)?.title).toBe("beta");

  await connection.close();
});

test("AsCollection AsFluent AsEnumCollection encrypted hashed casts", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("profiles", (table) => {
    table.id();
    table.text("options");
    table.text("meta");
    table.text("statuses");
    table.text("secret");
    table.string("password");
    table.timestamps();
  });

  const Status = { Ready: "ready", Pending: "pending" } as const;
  const {
    AsCollection,
    AsFluent,
    AsEnumCollection,
    collect,
  } = await import("../src/index.ts");
  const { Fluent, Crypt } = await import("@bunyad/common");

  class Profile extends Model {
    static table = "profiles";
    declare options: { all(): unknown[] };
    declare meta: InstanceType<typeof Fluent>;
    declare statuses: { all(): unknown[] };
    declare secret: string;
    declare password: string;
    static casts() {
      return {
        options: AsCollection,
        meta: AsFluent,
        statuses: AsEnumCollection.of(Status),
        secret: "encrypted" as const,
        password: "hashed" as const,
      };
    }
  }

  process.env.APP_KEY = "test-key-for-casts";

  const profile = await Profile.create({
    options: collect(["a", "b"]),
    meta: new Fluent({ theme: "dark" }),
    statuses: [Status.Ready, Status.Pending],
    secret: "top-secret",
    password: "plain-password",
  });

  const row = await connection.all<{
    options: string;
    meta: string;
    statuses: string;
    secret: string;
    password: string;
  }>("select * from profiles where id = ?", [profile.id]);
  expect(JSON.parse(row[0]!.options)).toEqual(["a", "b"]);
  expect(JSON.parse(row[0]!.meta)).toEqual({ theme: "dark" });
  expect(JSON.parse(row[0]!.statuses)).toEqual(["ready", "pending"]);
  expect(row[0]!.secret).not.toBe("top-secret");
  expect(Crypt.decrypt(row[0]!.secret)).toBe("top-secret");
  expect(row[0]!.password.startsWith("$2")).toBe(true);

  const loaded = await Profile.find(profile.id!);
  expect(loaded!.options.all()).toEqual(["a", "b"]);
  expect(loaded!.meta).toBeInstanceOf(Fluent);
  expect(String(loaded!.meta.get("theme"))).toBe("dark");
  expect(loaded!.statuses.all()).toEqual(["ready", "pending"]);
  expect(loaded!.secret).toBe("top-secret");
  expect(loaded!.password.startsWith("$2")).toBe(true);

  await connection.close();
});

test("dirty tracking timestamps whereHas withCount associate sync toggle", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("authors", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("articles", (table) => {
    table.id();
    table.string("title");
    table.integer("author_id").nullable();
    table.timestamps();
  });
  await schema.create("taggables", (table) => {
    table.id();
  });
  await schema.create("tags", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("article_tag", (table) => {
    table.integer("article_id");
    table.integer("tag_id");
  });

  class Author extends Model {
    static table = "authors";
    declare name: string;
    declare updated_at: string | Date | null;
    articles() {
      return this.hasMany(Article, "author_id");
    }
  }
  class Article extends Model {
    static table = "articles";
    static fillable = ["title", "author_id"];
    declare author_id: string | number;
    author() {
      return this.belongsTo(Author, "author_id");
    }
    tags() {
      return this.belongsToMany(Tag, "article_tag", "article_id", "tag_id");
    }
  }
  class Tag extends Model {
    static table = "tags";
    static timestamps = false;
  }

  const author = await Author.create({ name: "Ada" });
  expect(author.wasRecentlyCreated()).toBe(true);
  expect(author.isDirty()).toBe(false);

  author.name = "Ada Lovelace";
  expect(author.isDirty("name")).toBe(true);
  expect(author.getOriginal("name")).toBe("Ada");
  await author.save();
  expect(author.wasChanged("name")).toBe(true);
  expect(author.isDirty()).toBe(false);

  const prevUpdated = author.updated_at;
  await Author.withoutTimestamps(async () => {
    author.name = "Quiet";
    await author.save();
  });
  expect(author.name).toBe("Quiet");
  expect(author.updated_at).toBe(prevUpdated);

  const a1 = await Article.create({ title: "One", author_id: author.id });
  await Article.create({ title: "Two" });

  const withPosts = await Author.newQuery().has("articles").get();
  expect(withPosts).toHaveLength(1);

  const counted = await Author.newQuery().withCount("articles").first();
  expect(Number((counted as unknown as Record<string, unknown>).articles_count)).toBe(1);

  const filtered = await Author.newQuery()
    .whereHas("articles", (q) => {
      q.where("title", "One");
    })
    .get();
  expect(filtered).toHaveLength(1);

  const orphan = await Article.where("title", "Two").first();
  await orphan!.author().associate(author);
  await orphan!.save();
  expect(orphan!.author_id).toBe(author.id);

  const t1 = await Tag.create({ name: "php" });
  const t2 = await Tag.create({ name: "ts" });
  await a1.tags().attach([t1.id!, t2.id!]);
  await a1.tags().toggle(t1.id!);
  expect((await a1.tags().get()).pluck("name").all()).toEqual(["ts"]);
  await a1.tags().syncWithoutDetaching([t1.id!, t2.id!]);
  expect((await a1.tags().get()).count()).toBe(2);

  await connection.close();
});

test("global local scopes appends loadCount belongsToMany whereHas", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("shops", (table) => {
    table.id();
    table.string("name");
    table.integer("active");
    table.timestamps();
  });
  await schema.create("products", (table) => {
    table.id();
    table.string("title");
    table.integer("shop_id");
  });
  await schema.create("labels", (table) => {
    table.id();
    table.string("name");
  });
  await schema.create("label_shop", (table) => {
    table.integer("shop_id");
    table.integer("label_id");
  });

  class Label extends Model {
    static table = "labels";
    static timestamps = false;
  }

  class Product extends Model {
    static table = "products";
    static timestamps = false;
    declare title: string;
    declare shop_id: number;

    shop() {
      return this.belongsTo(Shop, "shop_id");
    }
  }

  class Shop extends Model {
    static table = "shops";
    static appends = ["display_name"];
    static fillable = ["name", "active"];
    declare name: string;

    getDisplayNameAttribute() {
      return `Shop: ${this.name}`;
    }

    static scopeActive(query: ModelQuery) {
      query.where("active", 1);
    }

    products() {
      return this.hasMany(Product, "shop_id");
    }

    labels() {
      return this.belongsToMany(Label, "label_shop", "shop_id", "label_id");
    }
  }

  Shop.addGlobalScope("notArchived", (query) => {
    query.where("name", "!=", "archived");
  });

  await Shop.create({ name: "Open", active: 1 });
  await Shop.create({ name: "Closed", active: 0 });
  await Shop.create({ name: "archived", active: 1 });

  expect(await Shop.newQuery().get()).toHaveLength(2);
  expect(await Shop.withoutGlobalScope("notArchived").get()).toHaveLength(3);
  expect(await (Shop.newQuery() as unknown as ModelQuery & { active(): ModelQuery }).active().get()).toHaveLength(1);
  // `Model::active()` — static local scope via __callStatic
  expect(await (Shop as unknown as { active(): ModelQuery }).active().get()).toHaveLength(1);

  // Local scopes work inside nested `where((q) => …)` groups
  const nestedActive = await Shop.where((q) => {
    (q as unknown as { active(): ModelQuery }).active();
  }).get();
  expect(nestedActive).toHaveLength(1);

  const open = await Shop.where("name", "Open").first();
  expect(open!.toArray().display_name).toBe("Shop: Open");

  const product = await Product.create({ title: "Mug", shop_id: open!.id });
  void product;

  // Local scopes on related whereHas callbacks (Proxy must unwrap for private fields)
  await Product.create({ title: "Inactive mug", shop_id: open!.id });
  const closed = await Shop.where("name", "Closed").first();
  await Product.create({ title: "Closed shop mug", shop_id: closed!.id });
  const activeShopProducts = await Product.query()
    .whereHas("shop", (sq) => {
      (sq as ModelQuery & { active(): ModelQuery }).active();
    })
    .get();
  expect(
    activeShopProducts
      .all()
      .map((p) => p.title)
      .sort(),
  ).toEqual(["Inactive mug", "Mug"]);

  const label = await Label.create({ name: "hot" });
  await open!.labels().attach(label.id!);

  const withLabels = await Shop.newQuery().whereHas("labels").get();
  expect(withLabels).toHaveLength(1);

  const counted = await Shop.newQuery().withCount("labels", "products").first();
  expect(Number((counted as unknown as Record<string, unknown>).labels_count)).toBe(1);
  expect(Number((counted as unknown as Record<string, unknown>).products_count)).toBe(2);

  await open!.loadCount("products");
  expect((open as unknown as Record<string, unknown>).products_count).toBe(2);

  Shop.removeGlobalScope("notArchived");
  await connection.close();
});

test("Model static terminals: get / pluck / count / scopes / no junk", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  await User.create({ email: "a@b.c", name: "Ada" });
  await User.create({ email: "b@b.c", name: "Bob" });

  // User.get() ≡ User.query().get() ≡ User.all()
  const viaStatic = await User.get();
  const viaQuery = await User.query().get();
  const viaAll = await User.all();
  expect(viaStatic.pluck("name").sort().all()).toEqual(["Ada", "Bob"]);
  expect(viaQuery.pluck("name").sort().all()).toEqual(["Ada", "Bob"]);
  expect(viaAll.pluck("name").sort().all()).toEqual(["Ada", "Bob"]);
  expect(typeof User.get).toBe("function");
  expect(typeof User.pluck).toBe("function");

  // User.pluck('name')
  expect((await User.pluck("name")).sort().all()).toEqual(["Ada", "Bob"]);

  // User.pluck('name','id') keyed — plain object key→value
  const keyed = await User.orderBy("id").pluck("name", "id");
  expect(keyed).toEqual({ "1": "Ada", "2": "Bob" });
  const keyedStatic = await User.pluck("name", "id");
  expect(keyedStatic).toEqual({ "1": "Ada", "2": "Bob" });
  // Reverse columns: id keyed by name
  expect(await User.orderBy("id").pluck("id", "name")).toEqual({
    Ada: 1,
    Bob: 2,
  });

  // User.where(...).pluck(...) still works (one-arg list + two-arg keyed)
  expect((await User.where("name", "Ada").pluck("email")).all()).toEqual([
    "a@b.c",
  ]);
  expect(await User.where("name", "Ada").pluck("name", "id")).toEqual({
    "1": "Ada",
  });

  // Other allowlisted terminals via Proxy (__callStatic)
  // Proxy terminals are runtime-only; no static typings exist for them.
  const DynamicUser = User as unknown as Record<string, (...args: unknown[]) => Promise<any>>;
  expect(await DynamicUser.count()).toBe(2);
  expect(await DynamicUser.exists()).toBe(true);
  expect(await DynamicUser.doesntExist()).toBe(false);
  expect(await DynamicUser.value("name")).toBeTruthy();
  expect((await DynamicUser.first())?.name).toBeTruthy();
  expect(await DynamicUser.sum("id")).toBeGreaterThan(0);

  // Local scopes still win when scopeFoo exists
  class Shop extends Model {
    declare name: string;
    static table = "shops_static_term";
    static timestamps = false;
    static fillable = ["name", "active"];
    static scopeActive(query: ModelQuery) {
      query.where("active", 1);
    }
  }
  await schemaFor(connection).create("shops_static_term", (table) => {
    table.id();
    table.string("name");
    table.integer("active");
  });
  await Shop.create({ name: "Open", active: 1 });
  await Shop.create({ name: "Closed", active: 0 });
  expect(
    await (Shop as unknown as { active(): ModelQuery }).active().count(),
  ).toBe(1);
  // Explicit statics still work (all / where / create)
  expect(await Shop.all()).toHaveLength(2);
  expect((await Shop.where("active", 0).first())?.name).toBe("Closed");

  // No forwarding of non-builder junk
  expect((User as unknown as Record<string, unknown>).notARealBuilderMethod).toBeUndefined();
  expect((User as unknown as Record<string, unknown>).then).toBeUndefined();
  expect(typeof (User as unknown as Record<string, unknown>).constructor).toBe(
    "function",
  );

  await connection.close();
});

test("ModelQuery toSql / orWhere / limit / value / pluck", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  await User.create({ email: "a@b.c", name: "Ada" });
  await User.create({ email: "b@b.c", name: "Bob" });

  const sql = User.where("name", "shah").toSql();
  expect(sql.toLowerCase()).toContain("select");
  expect(sql.toLowerCase()).toContain("from");
  expect(sql.toLowerCase()).toContain("users");
  expect(sql).toContain("?");
  expect(User.where("name", "shah").getBindings()).toEqual(["shah"]);
  expect(User.where("name", "Ada").toRawSql()).toContain("'Ada'");

  const found = await User.where("name", "Ada")
    .orWhere("name", "Nobody")
    .first();
  expect(found?.email).toBe("a@b.c");

  expect(await User.orderBy("name").limit(1).value("name")).toBe("Ada");
  expect((await User.orderBy("name").pluck("name")).all()).toEqual([
    "Ada",
    "Bob",
  ]);

  expect(await User.whereNull("email").count()).toBe(0);
  expect(await User.query().where("name", "Ada").count()).toBe(1);
  expect(await User.query().distinct().count("email")).toBe(2);
  expect(
    User.where("name", "Ada").when(true, (q) => q.where("email", "a@b.c")).toSql(),
  ).toContain("?");

  const updated = await User.where("name", "Bob").update({ name: "Robert" });
  expect(updated).toBe(1);
  expect(await User.where("name", "Robert").exists()).toBe(true);

  await connection.close();
});

test("Model.setConnection keeps named connection getName", async () => {
  const connection = connectSqlite();
  const { DB } = await import("@bunyad/database");
  DB.addConnection("analytics", connection);
  Model.setConnection(connection);
  expect(connection.getName()).toBe("analytics");
  expect(DB.getName()).toBe("analytics");
  await connection.close();
});

test("Model.on uses named connection for same model", async () => {
  const primary = connectSqlite();
  const secondary = connectSqlite();
  Model.setConnection(primary);
  const { DB } = await import("@bunyad/database");
  DB.addConnection("secondary", secondary);

  await schemaFor(primary).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });
  await schemaFor(secondary).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  await User.create({ email: "primary@test", name: "Primary" });
  await User.on("secondary").create({
    email: "secondary@test",
    name: "Secondary",
  });

  expect((await User.orderBy("id").pluck("name")).all()).toEqual(["Primary"]);
  expect((await User.on("secondary").orderBy("id").pluck("name")).all()).toEqual([
    "Secondary",
  ]);

  await DB.disconnect("secondary");
  await primary.close();
});

test("HasUuids assigns ordered uuid primary keys", async () => {
  const { HasUuids, uuid7, clearMorphMap } = await import("../src/index.ts");
  clearMorphMap();

  @HasUuids()
  class Article extends Model {
    declare title: string;
    static table = "articles";
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("articles", (table) => {
    table.string("id").primary();
    table.string("title");
    table.timestamps();
  });

  const article = (await Article.create({ title: "Hello" })) as Article;
  expect(typeof article.id).toBe("string");
  expect(String(article.id).length).toBe(36);
  expect(Article.incrementing).toBe(false);
  expect(article.exists).toBe(true);
  expect(uuid7()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect((await Article.find(article.id))?.title).toBe("Hello");

  await connection.close();
  clearMorphMap();
});

test("non-incrementing create with assigned primary key inserts", async () => {
  class Workspace extends Model {
    static table = "workspaces";
    static incrementing = false;
    static keyType = "string" as const;
    static fillable = ["id", "name"];
    declare id: string;
    declare name: string;
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("workspaces", (table) => {
    table.string("id").primary();
    table.string("name");
    table.timestamps();
  });

  const created = await Workspace.create({
    id: "ws-assigned-1",
    name: "Assigned",
  });
  expect(created.exists).toBe(true);
  expect(created.id).toBe("ws-assigned-1");
  expect((await Workspace.find("ws-assigned-1"))?.name).toBe("Assigned");

  await created.update({ name: "Updated" });
  expect((await Workspace.find("ws-assigned-1"))?.name).toBe("Updated");

  await connection.close();
});

test("Pivot create inserts without an id column", async () => {
  class ProductCategory extends Pivot {
    static table = "product_categories";
    static fillable = ["product_id", "category_id"];
    declare product_id: number;
    declare category_id: number;
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("product_categories", (table) => {
    table.integer("product_id");
    table.integer("category_id");
  });

  const row = await ProductCategory.create({
    product_id: 152,
    category_id: 73,
  });
  expect(row.exists).toBe(true);
  expect(row.product_id).toBe(152);
  expect(row.category_id).toBe(73);
  expect(
    await ProductCategory.where("product_id", 152).where("category_id", 73).count(),
  ).toBe(1);

  await connection.close();
});

test("morphToMany attach sync and with eager load", async () => {
  class Role extends Model {
    static table = "roles";
    static fillable = ["name", "tenant_id"];
    declare name: string;
    declare tenant_id: string;
  }

  class Contact extends Model {
    static table = "contacts";
    static fillable = ["name", "tenant_id"];
    declare name: string;
    declare tenant_id: string;
    roles() {
      return this.morphToMany(Role, "contact", {
        table: "model_has_roles",
        foreignPivotKey: "model_id",
        relatedPivotKey: "role_id",
        morphTypes: ["contact", "customer", "supplier"],
        pivotTenantKey: "tenant_id",
      });
    }
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("contacts", (table) => {
    table.id();
    table.string("name");
    table.string("tenant_id");
    table.timestamps();
  });
  await schema.create("roles", (table) => {
    table.id();
    table.string("name");
    table.string("tenant_id");
    table.timestamps();
  });
  await schema.create("model_has_roles", (table) => {
    table.integer("role_id");
    table.string("model_type");
    table.integer("model_id");
    table.string("tenant_id");
  });

  const contact = await Contact.create({
    name: "Ada",
    tenant_id: "t1",
  });
  const admin = await Role.create({ name: "Admin", tenant_id: "t1" });
  const staff = await Role.create({ name: "Staff", tenant_id: "t1" });

  await contact.roles().attach([admin.id as number, staff.id as number]);
  const roles = await contact.roles().get();
  expect(roles.count()).toBe(2);
  expect(roles.pluck("name").sort().all()).toEqual(["Admin", "Staff"]);

  await contact.roles().sync([admin.id as number]);
  expect((await contact.roles().get()).pluck("name").all()).toEqual(["Admin"]);

  const loaded = await Contact.with("roles").where("id", contact.id).first();
  expect(loaded).toBeTruthy();
  const eager = (loaded as Contact & { roles: OrmCollection<Role> }).roles;
  expect(eager.count()).toBe(1);
  expect(eager.first()!.name).toBe("Admin");

  const withRole = await Contact.whereHas("roles").get();
  expect(withRole.count()).toBe(1);

  await connection.close();
});

test("morphToMany parentTenantKey can differ from pivotTenantKey", async () => {
  class Tag extends Model {
    static table = "tags";
    static fillable = ["name"];
    declare name: string;
  }

  class Post extends Model {
    static table = "posts";
    static fillable = ["title", "org_id"];
    declare title: string;
    declare org_id: string;
    tags() {
      return this.morphToMany(Tag, "post", {
        table: "taggables",
        foreignPivotKey: "model_id",
        relatedPivotKey: "tag_id",
        morphTypes: ["post"],
        pivotTenantKey: "tenant_id",
        parentTenantKey: "org_id",
      });
    }
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("posts", (table) => {
    table.id();
    table.string("title");
    table.string("org_id");
    table.timestamps();
  });
  await schema.create("tags", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("taggables", (table) => {
    table.integer("tag_id");
    table.string("model_type");
    table.integer("model_id");
    table.string("tenant_id");
  });

  const post = await Post.create({ title: "Hello", org_id: "org-9" });
  const tag = await Tag.create({ name: "news" });
  await post.tags().attach(tag.id as number);

  const rows = await connection.all<{ tenant_id: string }>(
    "SELECT tenant_id FROM taggables",
  );
  expect(rows[0]?.tenant_id).toBe("org-9");
  expect((await post.tags().get()).first()!.name).toBe("news");
  expect((await Post.whereHas("tags").get()).count()).toBe(1);

  await connection.close();
});

test("HasFactory decorator exposes Model.factory()", async () => {
  const { HasFactory } = await import("../src/index.ts");

  class TagFactory extends Factory<Tag> {
    model() {
      return Tag;
    }
    definition() {
      return { name: "news" };
    }
  }

  @HasFactory(TagFactory)
  class Tag extends Model {
    declare name: string;
    static table = "tags";
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("tags", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });

  const tag = (await Tag.factory!().create()) as Tag;
  expect(tag.name).toBe("news");
  expect(tag.id).toBeTruthy();

  await connection.close();
});

test("Prunable deletes matching models via prune()", async () => {
  const {
    Prunable,
    SoftDeletes,
    prune,
    clearPrunableRegistries,
  } = await import("../src/index.ts");
  clearPrunableRegistries();

  @SoftDeletes()
  @Prunable()
  class OldPost extends Model {
    declare title: string;
    static table = "old_posts";
    static prunable() {
      return this.where("title", "stale");
    }
  }

  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("old_posts", (table) => {
    table.id();
    table.string("title");
    table.timestamp("deleted_at").nullable();
    table.timestamps();
  });

  await OldPost.create({ title: "keep" });
  await OldPost.create({ title: "stale" });
  await OldPost.create({ title: "stale" });

  const count = await prune(OldPost);
  expect(count).toBe(2);
  expect(await OldPost.where("title", "keep").exists()).toBe(true);
  expect(await OldPost.where("title", "stale").exists()).toBe(false);
  expect(await OldPost.withTrashed().where("title", "stale").exists()).toBe(
    false,
  );

  clearPrunableRegistries();
  await connection.close();
});

test("resolveRouteBinding excludes trashed; resolveSoftDeletableRouteBinding includes", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("articles", (table) => {
    table.id();
    table.string("title");
    table.text("deleted_at").nullable();
    table.timestamps();
  });

  class Article extends Model {
    static table = "articles";
    static softDeletes = true;
    declare title: string;
  }

  const row = (await Article.create({ title: "Draft" })) as Article;
  await row.delete();

  expect(await Article.resolveRouteBinding(row.id!)).toBeNull();
  const found = await Article.resolveSoftDeletableRouteBinding(row.id!);
  expect(found?.id).toBe(row.id);
  expect(found?.title).toBe("Draft");

  await connection.close();
});

test("Factory state sequence and afterCreating", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.timestamps();
  });

  const created: string[] = [];
  const made: string[] = [];

  const users = (await UserFactory.new()
    .state({ name: "Admin" })
    .sequence(
      { email: "a@example.com" },
      { email: "b@example.com" },
      (n) => ({ email: `seq-${n}@example.com` }),
    )
    .afterMaking((user) => {
      made.push(user.name);
    })
    .afterCreating((user) => {
      created.push(String(user.email));
    })
    .count(3)
    .create()) as User[];

  expect(users).toHaveLength(3);
  expect(users.map((u) => u.name)).toEqual(["Admin", "Admin", "Admin"]);
  expect(users.map((u) => u.email)).toEqual([
    "a@example.com",
    "b@example.com",
    "seq-3@example.com",
  ]);
  expect(made).toEqual(["Admin", "Admin", "Admin"]);
  expect(created).toEqual([
    "a@example.com",
    "b@example.com",
    "seq-3@example.com",
  ]);

  const draft = (await UserFactory.new()
    .state((attrs) => ({ name: `${String(attrs.name ?? "X")}!` }))
    .make()) as User;
  expect(draft.name.endsWith("!")).toBe(true);
  expect(draft.id).toBeUndefined();

  await connection.close();
});

test("Factory for has and fake helper", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("teams", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schemaFor(connection).create("users", (table) => {
    table.id();
    table.string("email").unique();
    table.string("name");
    table.integer("team_id").nullable();
    table.timestamps();
  });
  await schemaFor(connection).create("posts", (table) => {
    table.id();
    table.string("title");
    table.integer("user_id");
    table.timestamps();
  });

  class Team extends Model {
    static table = "teams";
    static fillable = ["name"];
  }
  class User extends Model {
    declare team_id: unknown;
    static table = "users";
    static fillable = ["email", "name", "team_id"];
    posts() {
      return this.hasMany(Post);
    }
  }
  class Post extends Model {
    static table = "posts";
    static fillable = ["title", "user_id"];
  }
  class TeamFactory extends Factory {
    protected model() {
      return Team;
    }
    definition() {
      return { name: fake().word() };
    }
  }
  class UserFactoryLocal extends Factory {
    protected model() {
      return User;
    }
    definition() {
      return { email: fake().email(), name: fake().name() };
    }
  }
  class PostFactory extends Factory {
    protected model() {
      return Post;
    }
    definition() {
      return { title: fake().sentence() };
    }
  }

  const team = (await TeamFactory.new().create()) as Team;
  const user = (await UserFactoryLocal.new()
    .for(team, "team_id")
    .has(PostFactory.new().count(2), "posts")
    .create()) as User;

  expect(user.team_id).toBe(team.id);
  const posts = await user.posts().get();
  expect(posts.count()).toBe(2);

  await connection.close();
});


test("hasMany relation forwards update and delete to the constrained query", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.timestamps();
  });

  const user = (await User.create({ name: "Rel" })) as User;
  const other = (await User.create({ name: "Other" })) as User;
  await user.posts().create({ title: "One" });
  await user.posts().create({ title: "Two" });
  await other.posts().create({ title: "Keep" });

  expect(await user.posts().where("title", "One").update({ title: "Uno" })).toBe(1);
  expect(await user.posts().where("title", "Uno").count()).toBe(1);
  expect(await user.posts().delete()).toBe(2);
  expect(await user.posts().count()).toBe(0);
  expect(await other.posts().count()).toBe(1);

  await connection.close();
});

test("hashed cast hashes on save without blocking the event loop", async () => {
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("accounts", (table) => {
    table.id();
    table.string("email");
    table.string("password");
    table.timestamps();
  });

  class Account extends Model {
    static table = "accounts";
    static fillable = ["email", "password"];
    declare password: string;
    static casts() {
      return { password: "hashed" as const };
    }
  }

  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  const account = (await Account.create({
    email: "a@example.com",
    password: "plain-password",
  })) as Account;
  clearInterval(timer);

  expect(ticks).toBeGreaterThan(0);
  const row = await connection.get<{ password: string }>(
    "SELECT password FROM accounts WHERE id = ?",
    [account.id],
  );
  expect(row!.password.startsWith("$2")).toBe(true);
  expect(await Bun.password.verify("plain-password", row!.password)).toBe(true);

  // Saving an already-hashed value does not hash it twice.
  const stored = row!.password;
  account.password = stored;
  await account.save();
  const again = await connection.get<{ password: string }>(
    "SELECT password FROM accounts WHERE id = ?",
    [account.id],
  );
  expect(again!.password).toBe(stored);

  await connection.close();
});
