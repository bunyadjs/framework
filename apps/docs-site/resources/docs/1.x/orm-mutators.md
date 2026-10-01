---
title: Mutators and Casting
description: Transform model attributes on read and write with casts and Attribute.make.
---

# Mutators and Casting

## Introduction

Casts and attribute mutators transform values when you hydrate a model from the database and when you persist it again. Use them to store JSON as objects, booleans as integers on SQLite, encrypted strings ciphertext, hashed passwords, or computed fields that map onto one or more columns.

Define casts on the model with a `static casts()` method (preferred) or a `static casts` object. Import `Attribute`, `AsCollection`, `AsFluent`, and `AsEnumCollection` from `@bunyad/orm`.

```ts
import { Model, Attribute } from "@bunyad/orm";

export default class User extends Model {
  static table = "users";

  static casts() {
    return {
      is_admin: "boolean" as const,
      options: "array" as const,
      price: Attribute.make({
        get: (_value, attributes) =>
          Number(attributes.price_cents ?? 0) / 100,
        set: (value) => ({
          price_cents: Math.round(Number(value) * 100),
        }),
      }),
    };
  }
}
```

## Attribute casting

Declare a map from attribute name to cast definition. Bunyad resolves that map through `Model.getCasts()` and applies it on hydrate (`"get"`) and on insert/update (`"set"`).

```ts title="app/Models/User.ts"
import { Model } from "@bunyad/orm";

export default class User extends Model {
  static table = "users";

  static casts() {
    return {
      is_admin: "boolean" as const,
      birthday: "date" as const,
      last_login_at: "datetime" as const,
      options: "array" as const,
    };
  }
}
```

You may also assign a plain object:

```ts
static casts = {
  is_admin: "boolean" as const,
  options: "json" as const,
};
```

Prefer `casts()` when the map includes enum objects or `Attribute.make(...)` instances.

### Built-in cast types

| Cast | On read | On write |
| --- | --- | --- |
| `boolean` / `bool` | JavaScript `boolean` | SQLite: `0` / `1`; Postgres: real boolean |
| `integer` / `int` | Truncated number | Truncated number |
| `number` / `float` / `double` / `real` / `decimal` | Finite number | Number |
| `bigint` | `bigint` | `bigint` |
| `string` | String | String |
| `array` / `json` | Parsed object or array | JSON string |
| `collection` | `Collection` from `@bunyad/common` | JSON array string |
| `date` | `Date` | Date storage string |
| `datetime` | `Date` | Date-time storage for the connection driver |
| `encrypted` | Decrypted string | Ciphertext via `Crypt` |
| `encrypted:array` / `encrypted:json` | Decrypted + parsed | Encrypted JSON |
| `encrypted:collection` | Decrypted `Collection` | Encrypted JSON array |
| `hashed` | Stored hash unchanged | bcrypt hash when the value is not already hashed |

Boolean set-casts treat `"0"`, `"false"`, `"no"`, and `"off"` as false, and `"1"`, `"true"`, `"yes"`, and `"on"` as true, so sync and form payloads stay consistent on SQLite.

```ts
const user = await User.find(1);
user.is_admin; // true | false

await User.create({
  name: "Ada",
  is_admin: true,
  options: { theme: "dark" },
});
```

### Array and JSON casting

`array` and `json` both parse a JSON column into a plain value on read and stringify on write:

```ts
static casts() {
  return {
    options: "array" as const,
    meta: "json" as const,
  };
}

const user = await User.find(1);
user.options.theme = "light";
await user.save();
```

Use `collection` when you want a fluent `Collection` instead of a raw array:

```ts
import { collect } from "@bunyad/common";

static casts() {
  return { tags: "collection" as const };
}

const post = await Post.create({
  title: "Hello",
  tags: collect(["news", "release"]),
});

post.tags.all(); // ["news", "release"]
```

### Date and datetime casting

`date` and `datetime` hydrate columns into `Date` instances. Storage formatting follows the active database driver via `@bunyad/database` helpers.

```ts
static casts() {
  return {
    birthday: "date" as const,
    published_at: "datetime" as const,
  };
}
```

When you serialize the model with `toArray()` / `toJSON()`, `Date` values become ISO-8601 strings. See [ORM Serialization](/docs/1.x/orm-serialization).

### Enum casting

Pass a TypeScript string/number enum object (or a plain value map) as the cast. On write, Bunyad stores the enum value; on read, it restores a matching entry from the map:

```ts
const ServerStatus = {
  Ready: "ready",
  Pending: "pending",
} as const;

export default class Server extends Model {
  static table = "servers";

  static casts() {
    return {
      status: ServerStatus,
    };
  }
}

const server = await Server.create({
  name: "web-1",
  status: ServerStatus.Ready,
});

server.status; // "ready"
```

### Encrypted casting

Encrypted casts use `Crypt` from `@bunyad/common` and therefore require `APP_KEY`. Use `encrypted` for strings, or the JSON variants for structured payloads:

```ts
static casts() {
  return {
    secret: "encrypted" as const,
    payload: "encrypted:json" as const,
    flags: "encrypted:collection" as const,
  };
}
```

:::warning
Encrypted attributes are only as safe as your application key. Rotate `APP_KEY` carefully and keep previous keys registered while old ciphertext still exists. See [Encryption](/docs/1.x/encryption).
:::

### Hashed casting

`hashed` runs Bun's bcrypt hasher when you assign a plain string that is not already a bcrypt or argon2 digest. Existing hashes pass through unchanged:

```ts
static casts() {
  return {
    password: "hashed" as const,
  };
}

await User.create({
  email: "ada@example.com",
  password: "secret",
});
```

For explicit hashing outside casts, use `Hash` from `@bunyad/auth` — see [Hashing](/docs/1.x/hashing).

## Accessors and mutators with `Attribute.make`

For custom get/set logic, put an `Attribute` in the casts map. `Attribute.make({ get, set })` is the factory; both callbacks are optional.

```ts
import { Model, Attribute } from "@bunyad/orm";

export default class User extends Model {
  static table = "users";

  static casts() {
    return {
      first_name: Attribute.make({
        get: (value) =>
          typeof value === "string" ? value.toUpperCase() : value,
        set: (value) =>
          typeof value === "string" ? value.toLowerCase() : value,
      }),
    };
  }
}
```

### Building a value from multiple attributes

The `get` callback receives `(value, attributes)`. Use `attributes` when the public field is derived from other columns:

```ts
price: Attribute.make({
  get: (_value, attributes) => Number(attributes.price_cents ?? 0) / 100,
  set: (value) => ({
    price_cents: Math.round(Number(value) * 100),
  }),
}),
```

When `set` returns a plain object, those keys are merged into the attribute bag before persistence (so `price` itself does not have to be a column). When it returns a scalar, that value is stored under the cast key.

### Appended accessors without a cast

For computed JSON fields that are not cast columns, define `get{Studly}Attribute()` and list the snake_case name on `static appends`. Those accessors run during `toArray()` — see [ORM Serialization](/docs/1.x/orm-serialization).

```ts
export default class Shop extends Model {
  static table = "shops";
  static appends = ["display_name"];

  declare name: string;

  getDisplayNameAttribute() {
    return `Shop: ${this.name}`;
  }
}
```

## Helper casts

### `AsCollection`

Same behavior as the `collection` cast type, exposed as a reusable `Attribute`:

```ts
import { AsCollection } from "@bunyad/orm";

static casts() {
  return { tags: AsCollection };
}
```

### `AsFluent`

Hydrate a JSON object column as a `Fluent` bag from `@bunyad/common`:

```ts
import { AsFluent } from "@bunyad/orm";

static casts() {
  return { settings: AsFluent };
}

const user = await User.find(1);
user.settings.get("theme");
```

### `AsEnumCollection`

Cast a JSON array to a `Collection` of enum values:

```ts
import { AsEnumCollection } from "@bunyad/orm";

const Status = { Open: "open", Closed: "closed" } as const;

static casts() {
  return {
    statuses: AsEnumCollection.of(Status),
  };
}
```

## Casting during fill and save

`fill` / `forceFill` run get-casts so in-memory properties match how you read them after hydrate. Inserts and updates run set-casts so the database receives storage-ready values. `Model.create` assigns raw attributes first so set-mutators can run on save, then re-hydrates get-casts from storage when the model defines casts.

```ts
const user = new User();
user.fill({ is_admin: "1", options: { theme: "dark" } });
await user.save();
```

You can also cast a plain object without a model instance:

```ts
User.castAttributes({ is_admin: "0" }, "set");
// { is_admin: 0 } on SQLite

User.castAttributes({ is_admin: 0 }, "get");
// { is_admin: false }
```
