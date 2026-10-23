---
title: ORM Serialization
description: Convert models to arrays and JSON with hidden attributes and appends.
---

# ORM Serialization

## Introduction

When you build APIs or pass models into views, you often need a plain object instead of a live model instance. models expose `toArray()`, `toJSON()`, and `toJson()` for that conversion. Loaded relations that already sit on the instance are included. For a curated public API shape, prefer [API Resources](/docs/1.x/orm-resources).

```ts
import User from "@/Models/User.ts";

const user = await User.with("roles").first();

return user!.toArray();
```

## Serializing models and collections

### Serializing to arrays

`toArray()` walks own attributes (skipping functions), drops `static hidden` keys, runs `static appends` / instance appends, and converts `Date` values to ISO-8601 strings:

```ts
const user = await User.find(1);

user!.toArray();
// { id: 1, name: "Ada", email: "ada@example.com", created_at: "2026-01-15T12:00:00.000Z", ... }
```

For a list of models, map each instance (or use a [resource collection](/docs/1.x/orm-resources)):

```ts
const users = await User.query().get();

users.all().map((user) => user.toArray());
```

### Serializing to JSON

`toJSON()` returns the same object as `toArray()`, except that `bigint` values become decimal strings (JSON has no `bigint`; `toArray()` keeps the native value). `toJson()` is an alias of `toJSON()` — both return a plain object; call `JSON.stringify` when you need a string:

```ts
const user = await User.find(1);

user!.toJSON();
JSON.stringify(user); // uses `toJSON` when the runtime serializes the model
```

Paginators serialize the same way: `JSON.stringify(await Post.paginate(15))` gives `{ data, links, meta }`, with every model following its own hidden, visible and appended rules. This also holds for `simplePaginate` and `cursorPaginate`.

### Relationships

Only relations that are already present on the instance appear in the serialized output — typically after `with(...)`, `load(...)`, or assignment. Relation method names are not invoked during serialization.

```ts
const user = await User.with("posts").find(1);

user!.toArray().posts; // array / collection of related models' attributes when loaded
```

## Hiding attributes from JSON

List attribute (or relation) names on `static hidden`. Those keys are omitted from `toArray()` / `toJSON()`:

```ts title="app/Models/User.ts"
import { Model } from "@bunyad/orm";

export default class User extends Model {
  static table = "users";
  static hidden = ["password", "remember_token"];

  declare name: string;
  declare email: string;
  declare password?: string;
}
```

```ts
const user = await User.create({
  name: "Ada",
  email: "ada@example.com",
  password: "secret",
});

user.toArray().password; // undefined
user.toArray().email; // "ada@example.com"
```

Hidden attributes remain available on the live model for application code (`user.password`). Hiding only affects serialization.

:::tip
Use resources when different endpoints need different visibility. `hidden` is a model-wide default; `JsonResource` lets each endpoint choose its fields.
:::

## Appending values to JSON

Appended attributes are computed values that are not (or not only) database columns. Define a `get{Studly}Attribute` method and list the snake_case name on `static appends`:

```ts title="app/Models/Shop.ts"
import { Model } from "@bunyad/orm";

export default class Shop extends Model {
  static table = "shops";
  static appends = ["display_name"];

  declare name: string;

  getDisplayNameAttribute() {
    return `Shop: ${this.name}`;
  }
}
```

```ts
const shop = await Shop.where("name", "Open").first();

shop!.toArray().display_name; // "Shop: Open"
```

Appended keys respect `hidden`. If a name appears in both lists, it is omitted.

### Appending at run time

Add or replace appends on one instance:

```ts
user.append("is_admin");
user.append("is_admin", "status");

user.setAppends(["is_admin"]);
user.getAppends(); // ["is_admin"]
```

`append` merges into the current list (class defaults plus prior instance appends). `setAppends` replaces the instance list entirely.

Accessors used only through appends are invoked during `toArray()`. They are not automatically available as live properties unless you also expose them another way (for example an `Attribute` cast — see [Mutators and Casting](/docs/1.x/orm-mutators)).

## Date serialization

`Date` attribute values become ISO-8601 strings inside `toArray()`:

```ts
static casts() {
  return {
    birthday: "date" as const,
    published_at: "datetime" as const,
  };
}

const post = await Post.find(1);
post!.toArray().published_at; // "2026-03-01T08:30:00.000Z"
```

Cast definitions control how dates are stored and hydrated. Serialization uses `Date.prototype.toISOString()` for values that are `Date` instances at serialize time, unless the attribute has a `date:FORMAT` / `datetime:FORMAT` cast, which formats the output (`date:Y-m-d` gives `"2026-03-01"`; tokens are listed in [Mutators and Casting](/docs/1.x/orm-mutators)).

`created_at` and `updated_at` are not cast by default, so SQLite returns them as stored text while Postgres and MySQL return `Date` values (serialized as ISO). Add `created_at: "datetime"` to `casts()` if you need one format on every driver.

To take a subset of the attributes, use `only`:

```ts
user.only("id", "name");        // { id: 1, name: "Ada" }
user.only(["id", "email"]);     // array form works too
```

## Casting and serialization together

Casts run on hydrate and save. Serialization reads the already-cast in-memory values (booleans stay booleans, arrays stay arrays, `Collection` instances are left as objects unless you map them in a resource).

```ts
static casts = {
  active: "boolean" as const,
  meta: "json" as const,
};
static hidden = ["secret"];

const profile = await Profile.find(1);
profile!.toArray();
// { id: 1, name: "Ada", active: true, meta: { theme: "dark" }, ... }
```

## When to use resources instead

| Approach | Use when |
| --- | --- |
| `toArray()` / `toJSON()` | Internal dumps, simple admin JSON, debugging |
| `JsonResource` | Public APIs, per-endpoint field sets, conditional relations |

Resources can still call `model.toArray()` inside `toArray()` when you want most columns plus a few overrides — but most APIs map fields explicitly for stability.
