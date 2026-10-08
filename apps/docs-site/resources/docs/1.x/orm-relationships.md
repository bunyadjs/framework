---
title: ORM Relationships
description: Define hasOne, hasMany, belongsTo, belongsToMany, through, and polymorphic relations on your models.
---

# ORM Relationships

Database tables often relate to one another. A post has many comments; a comment belongs to a post; a user may share many roles through a pivot. Bunyad’s models express those links as relationships you define once and reuse for lazy loads, eager loads, existence queries, and aggregates.

Relationships live on the model via `static relations` (preferred) or instance methods. Loaded results are typed properties you `declare` on the class. Relation *queries* go through `related('name')` (or the legacy instance method). Import models from `@/` and the ORM from `@bunyad/orm`.

```ts
import { Model, type OrmCollection } from "@bunyad/orm";
import Post from "@/Models/Post.ts";

export default class User extends Model {
  static table = "users";

  declare posts: OrmCollection<Post>;

  static relations = {
    posts: (m: User) => m.hasMany(Post),
  };
}

const user = await User.with("posts").find(1);
for (const post of user!.posts) {
  // ...
}
```

Supported relationship kinds:

- One to one (`hasOne` / `belongsTo`)
- One to many (`hasMany` / `belongsTo`)
- Many to many (`belongsToMany`)
- Has many through (`hasManyThrough`)
- Polymorphic one to one / one to many (`morphOne` / `morphMany` / `morphTo`)
- Polymorphic many to many (`morphToMany`) and its inverse (`morphedByMany`)

## Defining relationships

Register factories on `static relations`. Each factory receives the parent model instance and returns a relation object. Declare the property you will read after `with()` / `load()`:

```ts title="app/Models/User.ts"
import { Model, type OrmCollection } from "@bunyad/orm";
import Phone from "@/Models/Phone.ts";
import Post from "@/Models/Post.ts";

export default class User extends Model {
  static table = "users";

  declare phone: Phone | null;
  declare posts: OrmCollection<Post>;

  static relations = {
    phone: (m: User) => m.hasOne(Phone),
    posts: (m: User) => m.hasMany(Post),
  };
}
```

After an eager load, read the declared property. To run the relation query (create related rows, attach pivots, associate), call `related`:

```ts
const user = await User.with("posts").find(1);
user!.posts; // OrmCollection<Post>

const relation = user!.related("posts"); // HasMany
await relation.create({ title: "Hello" });
```

Instance methods named like the relation still work and are useful when you prefer `user.posts()` over `user.related("posts")`:

```ts
export default class User extends Model {
  static table = "users";

  posts() {
    return this.hasMany(Post);
  }
}

await user.posts().create({ title: "Hello" });
const hello = await user.posts().where("title", "Hello").first();
```

Relation objects forward common query methods (`where`, `orderBy`, `limit`, `count`, …) onto a constrained related query, so `user.posts().where(…).orderBy(…).get()` works the same as chaining on `Model.query()`.

### One to one / has one

A one-to-one link: a `User` has one `Phone`. Define `hasOne` on the parent:

```ts title="app/Models/User.ts"
import { Model } from "@bunyad/orm";
import Phone from "@/Models/Phone.ts";

export default class User extends Model {
  static table = "users";

  declare phone: Phone | null;

  static relations = {
    phone: (m: User) => m.hasOne(Phone),
  };
}
```

By convention the related table stores `{parent_singular}_id` (here `user_id`). Override the foreign key and local key when needed:

```ts
m.hasOne(Phone, "foreign_key");
m.hasOne(Phone, "foreign_key", "local_key");
```

Load or query:

```ts
const user = await User.with("phone").find(1);
user!.phone;

const phone = await (await User.find(1))!.related("phone").first();
```

`HasOne` exposes `get()`, `first()`, `create(attributes)`, and `touch()`. `get()` and `first()` both return a single model or `null`.

#### Inverse: belongs to

On `Phone`, define `belongsTo` so you can reach the owning user:

```ts title="app/Models/Phone.ts"
import { Model } from "@bunyad/orm";
import User from "@/Models/User.ts";

export default class Phone extends Model {
  static table = "phones";

  declare user: User | null;

  static relations = {
    user: (m: Phone) => m.belongsTo(User),
  };
}
```

Convention: foreign key `{related_singular}_id` on the child (`user_id`). Pass custom keys as needed:

```ts
m.belongsTo(User, "foreign_key");
m.belongsTo(User, "foreign_key", "owner_key");
```

`BelongsTo` supports `get()` / `first()`, `associate(model)`, `dissociate()`, and `touch()`:

```ts
const phone = await Phone.find(1);
phone!.related("user").associate(await User.find(2));
await phone!.save();

phone!.related("user").dissociate();
await phone!.save();
```

### One to many / has many

A parent with many children — for example a post and its comments:

```ts title="app/Models/Post.ts"
import { Model, type OrmCollection } from "@bunyad/orm";
import Comment from "@/Models/Comment.ts";

export default class Post extends Model {
  static table = "posts";

  declare comments: OrmCollection<Comment>;

  static relations = {
    comments: (m: Post) => m.hasMany(Comment),
  };
}
```

Convention foreign key: `{parent_singular}_id` (`post_id`). Override with:

```ts
m.hasMany(Comment, "foreign_key");
m.hasMany(Comment, "foreign_key", "local_key");
```

```ts
const post = await Post.with("comments").find(1);
for (const comment of post!.comments) {
  // ...
}

await post!.related("comments").create({ body: "Nice post" });
const first = await post!.related("comments").first();
```

`HasMany` provides `get()` (returns [`OrmCollection`](/docs/1.x/orm-collections)), `first()`, `create()`, and `touch()`.

### Default models

`belongsTo`, `hasOne` and `morphOne` can return an empty model instead of `null` when nothing matches, so templates and serializers don't need null checks. The default is a new, unsaved model; for `hasOne` / `morphOne` it already carries the owner's foreign key (and morph type):

```ts
class Post extends Model {
  author() {
    return this.belongsTo(User).withDefault({ name: "Guest Author" });
  }
}

class User extends Model {
  profile() {
    return this.hasOne(Profile).withDefault((profile, user) => {
      profile.bio = `${user.name} has no bio yet`;
    });
  }
}
```

`withDefault()` with no argument returns an empty instance. It applies to `relation().first()` and to eager loading (`with("author")`), and only fills the rows that matched nothing.

### Has one of many

When a parent has many related rows but you want the “latest”, “oldest”, or aggregate winner as a `hasOne`, chain `latestOfMany`, `oldestOfMany`, or `ofMany` on `hasOne` (or `morphOne`):

```ts
static relations = {
  latestOrder: (m: User) => m.hasOne(Order, "user_id").latestOfMany(),
  oldestOrder: (m: User) => m.hasOne(Order, "user_id").oldestOfMany(),
  bestOrder: (m: User) => m.hasOne(Order, "user_id").ofMany("total", "max"),
};
```

`latestOfMany` / `oldestOfMany` default the compared column to the related model’s primary key. Soft-deleted related rows are excluded from the of-many subquery when the related model uses soft deletes. These relations eager-load efficiently with `with("latestOrder")`.

### Has many through

Reach a distant relation through an intermediate model. Example: a country has many posts through users:

```ts
import { Model, type OrmCollection } from "@bunyad/orm";
import Post from "@/Models/Post.ts";
import User from "@/Models/User.ts";

export default class Country extends Model {
  static table = "countries";

  declare posts: OrmCollection<Post>;

  static relations = {
    posts: (m: Country) => m.hasManyThrough(Post, User),
  };
}
```

Key arguments, in order: related model, through model, then optional `firstKey`, `secondKey`, `localKey`, `secondLocalKey`:

```ts
m.hasManyThrough(
  Post,
  User,
  "country_id", // users.country_id → countries.id
  "user_id", // posts.user_id → users.id
  "id",
  "id",
);
```

Defaults: `firstKey` = `{parent_singular}_id`, `secondKey` = `{through_singular}_id`, `localKey` / `secondLocalKey` = each model’s primary key.

`HasManyThrough` supports `get()` and `first()`, and eager loads with `Country.with("posts")`.

### Many to many / belongs to many

Users and roles (or posts and tags) share a pivot table. Define `belongsToMany`:

```ts title="app/Models/User.ts"
import { Model, type OrmCollection } from "@bunyad/orm";
import Role from "@/Models/Role.ts";

export default class User extends Model {
  static table = "users";

  declare roles: OrmCollection<Role>;

  static relations = {
    roles: (m: User) => m.belongsToMany(Role),
  };
}
```

By default the pivot table name is the two singular table names sorted alphabetically and joined with `_` (for example `role_user`). Foreign keys default to `{parent_singular}_id` and `{related_singular}_id`. Pass them explicitly when your schema differs:

```ts
m.belongsToMany(Role, "role_user", "user_id", "role_id");
```

Pivot helpers on `BelongsToMany`:

```ts
const user = await User.find(1);
const roles = user!.related("roles");

await roles.attach([1, 2]);
await roles.attach(3, { active: true }); // pivot attributes
await roles.attach({ 4: { active: false }, 5: { active: true } }); // per-id attributes
await roles.detach(1); // returns the number of deleted rows
await roles.detach(); // all
await roles.updateExistingPivot(3, { active: false }); // returns affected rows
await roles.sync([2, 3]); // diff: attach new, detach removed, keep the rest
await roles.sync({ 2: { active: true }, 6: { active: false } }); // sync with pivot attributes
await roles.syncWithoutDetaching([4]); // attach missing only
await roles.toggle([2, 5]); // attach missing, detach present

const collection = await roles.get();
```

`sync` and `syncWithoutDetaching` return `{ attached, detached, updated }`; `toggle` returns `{ attached, detached }`. `sync` compares against the existing pivot rows, so rows that stay keep their pivot data. `attach` writes one multi-row `INSERT` per chunk, so attaching thousands of ids is cheap. Ids may also be model instances.

To stamp `created_at` / `updated_at` on pivot writes, call `withTimestamps()` when defining the relation.

Extra pivot columns: call `withPivot` when defining the relation. Those columns (plus the pivot foreign keys) are available on each related model as `model.pivot`:

```ts
roles() {
  return this.belongsToMany(Role).withPivot("active", "created_by");
}

const roles = await user.roles().get();
roles.all()[0]?.pivot?.active;
```

`withPivot` applies to lazy `get()` / `first()` and to eager `with("roles")`.

Constrain or order by pivot columns with `wherePivot`, `wherePivotIn`, `wherePivotNotIn`, `wherePivotNull`, `wherePivotNotNull`, `wherePivotBetween`, `wherePivotNotBetween` and `orderByPivot`. The constraint applies everywhere the relation is used: `get()`, eager loading, `whereHas`, `withCount` and the other aggregates. It also scopes the writes. `attach` fills `wherePivot(column, value)` equality constraints as defaults, and `sync`, `detach` and `updateExistingPivot` only touch rows that match, so two relations can share one pivot table:

```ts
class Project extends Model {
  leads() {
    return this.belongsToMany(User).wherePivot("role", "lead");
  }
  members() {
    return this.belongsToMany(User).wherePivot("role", "member").orderByPivot("rank", "desc");
  }
}

await project.leads().attach([1, 2]);   // pivot rows get role = "lead"
await project.leads().sync([2, 3]);     // never touches the "member" rows
```


For composite / non-incrementing pivot rows as their own model, extend `Pivot` from `@bunyad/orm` (`incrementing = false`, `timestamps = false` by default).

## Polymorphic relationships

### Morph one / morph many / morph to

A commentable image or a set of comments may belong to more than one parent type. On the parent:

```ts
static relations = {
  image: (m: Post) => m.morphOne(Image, "imageable"),
  comments: (m: Post) => m.morphMany(Comment, "commentable"),
};
```

That stores `imageable_type` / `imageable_id` (or `commentable_type` / `commentable_id`). Override type, id, and local key columns when needed:

```ts
m.morphMany(Comment, "commentable", "commentable_type", "commentable_id", "id");
```

On the child, define `morphTo`:

```ts
static relations = {
  commentable: (m: Comment) => m.morphTo("commentable"),
};
```

`MorphTo` resolves the parent through the morph map (see below), and supports `associate` / `dissociate`:

```ts
comment.related("commentable").associate(post);
comment.related("commentable").dissociate();
```

`MorphOne` also supports `ofMany` / `latestOfMany` / `oldestOfMany`, same as `HasOne`.

### Morph to many

Polymorphic many-to-many (for example contacts and roles via `model_has_roles`):

```ts
roles() {
  return this.morphToMany(Role, "contact", {
    table: "model_has_roles",
    foreignPivotKey: "model_id",
    relatedPivotKey: "role_id",
    morphTypes: ["contact", "customer", "supplier"],
    pivotTenantKey: "tenant_id",
  });
}
```

The third argument may be a pivot table string or an options bag (`MorphToManyOptions`): `table`, `foreignPivotKey`, `relatedPivotKey`, `morphTypeColumn`, `morphTypes`, `pivotTenantKey`, `parentTenantKey`.

`MorphToMany` supports the same attach / detach / sync / syncWithoutDetaching / toggle / get API as `belongsToMany`, scoped by morph type (and optional tenant). `attach` writes multi-row inserts and `sync` only changes the rows that differ, so existing pivot rows stay untouched.

### Morphed by many

`morphedByMany` is the inverse of Laravel's `morphToMany`. The pivot stores the related model's id and morph type, so a `Tag` can own posts and videos through one `taggables` table:

```ts
class Tag extends Model {
  posts() {
    return this.morphedByMany(Post, "taggable");
  }
  videos() {
    return this.morphedByMany(Video, "taggable");
  }
}
```

Defaults follow Laravel: pivot table `taggables`, columns `taggable_id` / `taggable_type`, and `tag_id` for the parent. Pass `table`, `foreignPivotKey` and `relatedPivotKey` to override them. It supports `get`, `attach`, `detach`, `sync`, `syncWithoutDetaching`, `toggle` and eager loading with `with("posts")`. `whereHas`, `withCount` and the other aggregates work on it too.

### Custom polymorphic types

Register aliases so stored `*_type` values stay stable:

```ts
import { morphMap } from "@bunyad/orm";
import Post from "@/Models/Post.ts";
import Video from "@/Models/Video.ts";

morphMap({
  post: Post,
  video: Video,
});
```

`morphTypeFor` uses the alias when present; otherwise the model class name. Classes the ORM has already used are resolved by name when a stored type has no alias, so an unmapped `commentable_type = "Post"` still loads through `morphTo`. If two different model classes share a name, the name is never resolved on its own (it would be a guess), so map that type explicitly. A type the ORM has never seen throws `No morph map entry for [Type]`, so register aliases during boot for every type you persist.

Like Laravel, `morphMap()` with no arguments returns the current map, and `morphMap(map, false)` replaces it instead of merging. To stop class names from ever being stored, enforce the map:

```ts
import { enforceMorphMap, requireMorphMap } from "@bunyad/orm";

enforceMorphMap({ post: Post, video: Video });
// Using a model without an alias in a polymorphic relation now throws:
// No morph map defined for [Comment].

requireMorphMap(false); // turn enforcement off again
```

`getMorphedModel("post")` returns the class registered for an alias.

### Editor hints for relation names

`with`, `whereHas`, `has`, `withWhereHas` and friends suggest your model's relation methods as you type, and `where`, `orderBy`, `whereIn`, `whereNull` suggest its declared fields. Any other string still compiles, so `"posts.comments"`, `"posts as p"`, `"orders.total"` and names built at runtime keep working:

```ts
await User.with("posts")           // suggests: posts, profile, …
  .where("email", "ada@example.com") // suggests: id, name, email, …
  .orderBy("created_at", "desc")
  .get();
```

The helper types `RelationNames<User>` and `ColumnNames<User>` are exported if you want to type your own helpers.

## Querying relations

### Relationship methods vs loaded properties

| Goal | API |
| --- | --- |
| Read after eager load | `model.posts` (declared property) |
| Relation object / mutate | `model.related("posts")` or `model.posts()` |
| Eager on a query | `User.with("posts", "roles")` |
| Lazy eager on one model | `await model.load("posts")` |
| Lazy eager if missing | `await model.loadMissing("posts")` |

Nested paths work: `with("comments.author")`, `load("posts.tags")`.

Check whether a relation is already present with `relationLoaded("posts")`.

### Querying relationship existence

Keep parents that have (or lack) related rows:

```ts
await User.has("posts").get();
await User.doesntHave("posts").get();

await User.whereHas("posts", (q) => {
  q.where("published", true);
}).get();

await User.whereDoesntHave("posts").get();
await User.orWhereHas("posts").get();
await User.orWhereDoesntHave("posts").get();
```

`whereHas` / `has` work for `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`, and `morphToMany`. Belongs-to existence uses an inner join on the parent query; has-many / many-to-many use `EXISTS` (or an `IN` subquery where that is cheaper).

Shorthand column constraints:

```ts
await User.whereRelation("posts", "published", true).get();
await User.orWhereRelation("posts", "title", "like", "%draft%").get();
```

Constrain by a related model instance:

```ts
const author = await User.find(1);
await Post.whereBelongsTo(author).get();
await Post.whereBelongsTo(author, "author").get();
await Post.orWhereBelongsTo(author).get();
```

### Querying morph to relationships

```ts
await Comment.whereMorphedTo("commentable", post).get();
await Comment.whereNotMorphedTo("commentable", post).get();
await Comment.orWhereMorphedTo("commentable", post).get();

await Comment.whereHasMorph("commentable", [Post, Video], (q) => {
  q.where("title", "like", "%news%");
}).get();

await Comment.whereDoesntHaveMorph("commentable", Post).get();
await Comment.hasMorph("commentable", [Post]).get();
```

### Combining existence and eager load

`withWhereHas` runs `whereHas` and also eager-loads the relation name:

```ts
const shops = await Shop.withWhereHas("items", (q) => {
  q.where("featured", 1);
}).get();
```

Parents are filtered by the constraint; the eager load fetches the named relation for those parents.

## Aggregating related models

### Counting related models

```ts
const users = await User.withCount("posts").get();
users.first()!.posts_count;

await User.withCount("posts as post_total").get();
await User.withCount({ products: { as: "productsCount" } }).get();
```

Constrain the counted rows with a closure. Combine it with an alias to get several counts of one relation:

```ts
await Customer.withCount({
  payments: true,
  "payments as paid_count": (q) => q.where("status", "paid"),
}).get();
```

On an instance or [`OrmCollection`](/docs/1.x/orm-collections):

```ts
await user.loadCount("posts");
await users.loadCount("posts");
```

### Other aggregates

```ts
await User.withSum("orders", "total").get(); // orders_sum_total
await User.withAvg("orders", "total").get();
await User.withMin("orders", "total").get();
await User.withMax("orders", "total").get();
await User.withExists("posts").get(); // posts_exists
await User.withAggregate("orders", "total", "sum").get();

await user.loadSum("orders", "total");
await user.loadAvg("orders", "total");
await user.loadMin("orders", "total");
await user.loadMax("orders", "total");
await user.loadExists("posts");
```

Aliases use `relation as alias` the same way as counts: `withSum("orders as revenue", "total")`.

Pass a map to constrain the aggregated rows. This is the way to build conditional sums (what some tools call `sumCase`):

```ts
await Customer.withSum(
  { "payments as paid_total": (q) => q.where("status", "paid") },
  "amount",
)
  .withExists({ "payments as has_paid": (q) => q.where("status", "paid") })
  .get();
```

Constraints work for `withCount`, `withSum`, `withAvg`, `withMin`, `withMax`, `withExists` and `withAggregate`. Aggregates work on `hasMany`, `hasOne`, `belongsTo`, `belongsToMany`, `hasManyThrough`, `hasOneThrough`, `morphMany`, `morphOne` and `morphToMany`. Soft-deleted rows and the related model's global scopes are applied (call `q.withoutGlobalScopes()` inside the closure to opt out), and aggregating an unknown relation throws. `whereHas` and many-to-many eager loads apply the related model's global scopes the same way. For a single table, use `selectRaw("SUM(CASE WHEN status = ? THEN amount ELSE 0 END) as paid_total", ["paid"])`.

## Eager loading

### Basic eager loading

Avoid the N+1 problem by loading relations up front:

```ts
const users = await User.with("posts").get();
const users = await User.with("posts", "roles").get();
const users = await User.with(["posts", "roles"]).get();
const users = await User.with({ posts: true, roles: true }).get();
```

Constrain the related query while eager-loading:

```ts
const users = await User.with({
  posts: (q) => q.where("published", true).orderBy("title"),
}).get();
```

Nested:

```ts
await Post.with("comments.author").get();
```

Eager loading batches related rows with `WHERE IN` (chunked for large id lists) for belongs-to, has-many, has-one, belongs-to-many, morph relations, has-many-through, and of-many. Constraints from the `with({ relation: fn })` form are applied to each related query.

### Limiting eager loaded rows per parent

`limit` and `offset` inside an eager load constraint apply to each parent, not to the whole batched query:

```ts
// the 3 newest posts of every user (not 3 posts in total)
await User.with({
  posts: (q) => q.orderBy("created_at", "desc").limit(3),
}).get();
```

This works for `hasMany`, `morphMany`, `belongsToMany`, `morphToMany` and `morphedByMany`. The ORM loads the ordered rows once and trims each parent's list, so keep the constraint selective (add `where` conditions) when a parent can have very many related rows.

### Lazy eager loading

```ts
const user = await User.find(1);
await user!.load("posts", "roles");
await user!.loadMissing("posts"); // skip if already loaded
```

On a collection returned from `get()`:

```ts
const users = await User.all();
await users.load("posts");
await users.loadMissing("roles");
```

### Preventing lazy loading

In development you can forbid resolving unloaded relations through `related()`:

```ts
import { Model } from "@bunyad/orm";

Model.preventLazyLoading(true);
```

Accessing `related("posts")` on an existing model that has not loaded `posts` throws `LazyLoadingViolationException`. Eager loads (`with` / `load`) are exempt. Turn it off with `Model.preventLazyLoading(false)`.

## Inserting and updating related models

### Create on has-one / has-many / morph

```ts
await user.related("posts").create({ title: "First" });
await user.related("phone").create({ number: "555-0100" });
await post.related("comments").create({ body: "Hi" });
```

The foreign key (and morph type/id for morph relations) is set for you.

### Belongs to: associate / dissociate

```ts
post.related("author").associate(user);
await post.save();

post.related("author").dissociate();
await post.save();
```

### Many to many: attach, detach, sync, toggle

See [Many to many](#many-to-many--belongs-to-many) and [Morph to many](#morph-to-many) above. Always `await` these methods.

## Touching parent timestamps

List relation names on `static touches`. When the child is saved or deleted, Bunyad touches those related models’ `updated_at` (honoring `Model.withoutTouching` and `timestamps = false` on the related class):

```ts
export default class Comment extends Model {
  static table = "comments";
  static touches = ["post"];

  static relations = {
    post: (m: Comment) => m.belongsTo(Post),
  };
}
```

Helpers: `model.touches("post")`, `await model.touchOwners()`, and relation `touch()` on belongs-to / has-one / has-many.

## See also

- [ORM](/docs/1.x/orm) — models, queries, and persistence
- [ORM Collections](/docs/1.x/orm-collections) — `OrmCollection` from `get()` and relations
- [Collections](/docs/1.x/collections) — base `Collection` methods inherited by `OrmCollection`
