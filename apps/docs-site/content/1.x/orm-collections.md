---
title: ORM Collections
description: Work with OrmCollection results from get() and relations — load, find, and aggregate related models.
---

# ORM Collections

Any model query that returns more than one model yields an `OrmCollection` from `@bunyad/orm`. That includes `get()`, `all()`, and relation `get()` on has-many / belongs-to-many style links. `OrmCollection` extends the base [`Collection`](/docs/1.x/collections) from `@bunyad/common`, so you keep map / filter / pluck / sort and gain model-aware helpers for primary keys and eager loading.

```ts
import User from "@/Models/User.ts";

const users = await User.where("active", 1).get();

for (const user of users) {
  console.log(user.name);
}
```

Chain collection transforms the same way you would on a base collection:

```ts
const names = (await User.all())
  .reject((user) => user.active === false)
  .pluck("name");
```

Most inherited methods return a new `OrmCollection` when the items remain models (via `OrmCollection`’s `make`). Methods that return scalars or heterogeneous values follow the base [`Collection`](/docs/1.x/collections) rules.

Import `OrmCollection` when you need the type on declared relation properties:

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
```

## Available methods

`OrmCollection` inherits the full base collection API. The sections below cover the **extra** methods defined on `OrmCollection`. For `map`, `filter`, `pluck`, `sort`, `groupBy`, `partition`, `diff`, `intersect`, and the rest, see [Collections](/docs/1.x/collections).

### `find(key)` / `find(keys)`

Find a model by primary key, or filter to the models whose keys appear in an array:

```ts
const users = await User.all();

const user = users.find(1); // User | null
const subset = users.find([1, 2, 3]); // OrmCollection<User>
```

Keys are compared as strings, so `number` and `bigint` ids match.

### `findOrFail(key)`

Same as `find` for a single key, but throws if the model is missing:

```ts
const user = users.findOrFail(1);
```

### `modelKeys()`

Primary keys of every model in the collection, as a base `Collection`:

```ts
users.modelKeys();
// Collection of id values, e.g. [1, 2, 3]
```

### `load(...relations)`

Eager-load relations onto every model in the collection (same batching as `Model.with` / `model.load`):

```ts
const users = await User.where("active", 1).get();
await users.load("posts", "roles");
await users.load("posts.comments");
```

Returns the same collection instance (`Promise<this>`). Nested paths are supported. See [ORM Relationships](/docs/1.x/orm-relationships) for relation types.

### `loadMissing(...relations)`

Load only relations that are not already present on at least one model that still needs them:

```ts
await users.load("posts");
await users.loadMissing("posts", "roles"); // posts skipped when already loaded
```

### `loadCount(...relations)`

Attach relation counts on each model (default attribute `{relation}_count`, or an alias):

```ts
await users.loadCount("posts");
await users.loadCount("posts as post_total");

users.first()!.posts_count;
```

Counts are batched across the collection.

### `loadSum` / `loadAvg` / `loadMin` / `loadMax`

Aggregate a column on a relation for every model:

```ts
await users.loadSum("orders", "total"); // orders_sum_total
await users.loadAvg("orders", "total");
await users.loadMin("orders", "total");
await users.loadMax("orders", "total");

await users.loadSum("orders as revenue", "total");
```

### `loadExists(...relations)`

Boolean-style existence flags (`{relation}_exists`):

```ts
await users.loadExists("posts");
await users.loadExists("posts as has_posts");
```

## Iterating and converting

`OrmCollection` is iterable. Use `for...of`, spread into arrays when you need a plain list at an HTTP boundary, or call `all()` / `toArray()`:

```ts
const users = await User.all();

for (const user of users) {
  // ...
}

users.all(); // User[]
users.count();
users.isEmpty();
```

## See also

- [ORM](/docs/1.x/orm) — querying models that return `OrmCollection`
- [ORM Relationships](/docs/1.x/orm-relationships) — relation `get()` and eager `load`
- [Collections](/docs/1.x/collections) — base fluent collection API
