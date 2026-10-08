---
title: ORM Factories
description: Define default model attributes for tests and seeders with Factory.
---

# ORM Factories

## Introduction

Model factories give each model a default attribute bag for tests and seeders. Instead of hand-writing every column, you define `definition()`, then `make` in-memory instances or `create` persisted rows.

Factories live under `database/factories` and extend `Factory` from `@bunyad/orm`.

```ts
import { Factory } from "@bunyad/orm";
import User from "../../app/Models/User.ts";

export default class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  definition() {
    return {
      name: "Ada Lovelace",
      email: "ada@example.com",
    };
  }
}
```

## Generating factories

Create a factory stub:

```bash
bunyad make:factory UserFactory
```

or:

```bash
bunyad make:factory User
```

Both write `database/factories/UserFactory.ts` with a `model()` method pointing at `app/Models/User.ts` and an empty `definition()` body.

## Defining factories

A factory must:

1. Extend `Factory<YourModel>`
2. Implement `model()` returning the model class
3. Implement `definition()` returning (or resolving to) a plain attribute object

```ts title="database/factories/UserFactory.ts"
import { Factory } from "@bunyad/orm";
import User from "../../app/Models/User.ts";

export default class UserFactory extends Factory<User> {
  model() {
    return User;
  }

  definition() {
    return {
      name: "User",
      email: `user-${Date.now()}@example.com`,
    };
  }
}
```

`definition` may be `async` and return a `Promise` of attributes. Values you pass to `make` / `create` override the definition for that call.

### Binding the factory on the model

**Option A — static `factory()` method**

```ts title="app/Models/User.ts"
import { Model } from "@bunyad/orm";
import UserFactory from "../../database/factories/UserFactory.ts";

export default class User extends Model {
  static table = "users";

  static factory() {
    return new UserFactory();
  }
}
```

**Option B — `@HasFactory` decorator**

```ts
import { Model, HasFactory } from "@bunyad/orm";
import UserFactory from "../../database/factories/UserFactory.ts";

@HasFactory(UserFactory)
export default class User extends Model {
  static table = "users";
}
```

`@HasFactory` also accepts a factory function: `@HasFactory(() => new UserFactory())`.

After either approach:

```ts
await User.factory().create();
```

You can always construct the factory directly:

```ts
import UserFactory from "../../database/factories/UserFactory.ts";

await UserFactory.new().create();
```

`Factory.new()` is the static constructor helper.

## Creating models

### Instantiating models (`make`)

`make` builds model instances **without** inserting them:

```ts
const draft = await User.factory().make();
const named = await User.factory().make({ name: "Draft" });

draft.id; // undefined until you save
await User.all(); // unchanged
```

### Persisting models (`create`)

`create` merges definition attributes with overrides and persists with `Model.forceCreate` (guarded columns are set too; casts and events apply as usual):

```ts
const user = await User.factory().create();
const admin = await User.factory().create({
  email: "admin@example.com",
  name: "Admin",
});
```

### Creating multiple models (`count`)

Chain `count(n)` before `make` or `create`. A count of `1` (the default) returns a single model; higher counts return an array:

```ts
const users = await User.factory().count(3).create();
// User[]

const one = await User.factory().count(1).create();
// User
```

`count` resets to `1` after each `make` / `create` call, so later calls without `count` create a single model again.

```ts
await User.factory().count(3).create();
await User.factory().create(); // one model
```

## Overrides and helpers

Pass attribute overrides as the argument to `make` / `create`. They win over `definition()`:

```ts
await User.factory().create({
  email: "admin@example.com",
  email_verified_at: null,
});
```

Keep alternate attribute sets as plain objects (or small helpers) and pass them in:

```ts
const unverified = { email_verified_at: null };

await User.factory().create(unverified);
await User.factory().create({
  ...unverified,
  email: "pending@example.com",
});
```

### States and sequences

`state` merges attributes (or the result of a callback that receives the current attributes) into every model. `sequence` cycles attribute sets across a batch; a callback receives a 1-based index:

```ts
await User.factory().state({ role: "admin" }).create();

await User.factory()
  .count(4)
  .sequence({ plan: "free" }, (i) => ({ plan: "pro", seat: i }))
  .create();
```

### Callbacks

`afterMaking` runs on the unsaved model, before the insert. `afterCreating` runs after the row exists:

```ts
User.factory()
  .afterMaking((user) => { user.name = user.name.trim(); })
  .afterCreating(async (user) => { await user.related("profile").create({ bio: "" }); });
```

Override `configure()` to set defaults once per factory instance, before its first `make` / `create`:

```ts
configure() {
  return this.afterCreating((user) => { /* … */ });
}
```

### Creating many models

```ts
await User.factory().createOne({ name: "Ada" });
await User.factory().createMany(3);
await User.factory().createMany([{ name: "Ada" }, { name: "Grace" }]);
await User.factory().createQuietly(); // no model events
await User.factory().createManyQuietly(10);
await User.factory().makeOne();
```

### Relationships

```ts
// belongsTo: the parent is created once for the whole batch, then reused.
await Post.factory().count(5).for(UserFactory.new()).create();
// or reuse a model you already have
await Post.factory().count(5).for(user).create();

// hasMany / morphMany: children get the foreign key (and morph type) set.
await User.factory().has(PostFactory.new().count(3)).create();
await Team.factory().has(NoteFactory.new().count(2), "comments").create();

// belongsToMany: related models are attached, with pivot attributes.
await User.factory().hasAttached(RoleFactory.new().count(2), { active: true }).create();
await User.factory().hasAttached(RoleFactory.new().count(2), (role) => ({ label: role.name })).create();
```

`for(parent)` fills the child's `belongsTo` foreign key. It looks for a relation named after the parent class (`user()` for a `User`) and falls back to `user_id`. Pass the relationship name as the second argument when it differs: `for(user, "author")`.

## Using factories in seeders and tests

```ts title="database/seeders/UserSeeder.ts"
import { Seeder } from "@bunyad/database";
import User from "../../app/Models/User.ts";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.factory().count(10).create();
  }
}
```

```ts
import { expect, test } from "bun:test";
import User from "@/Models/User.ts";

test("user can be created from a factory", async () => {
  const user = await User.factory().create({ name: "Ada" });
  expect(user.name).toBe("Ada");
  expect(user.id).toBeTruthy();
});
```

Factories respect model casts and mutators on `create`. See [Mutators and Casting](/docs/1.x/orm-mutators).

## Quick reference

| API | Package | Role |
| --- | --- | --- |
| `Factory` | `@bunyad/orm` | Abstract base class |
| `Factory.new()` | `@bunyad/orm` | Construct a factory instance |
| `definition()` | subclass | Default attributes |
| `model()` | subclass | Model class to build |
| `count(n)` | instance | How many models for the next make/create |
| `make(attrs?)` | instance | In-memory model(s) |
| `create(attrs?)` | instance | Persisted model(s) via `Model.forceCreate` |
| `state` / `sequence` | instance | Attribute overrides per model / cycled across a batch |
| `afterMaking` / `afterCreating` / `configure` | instance | Lifecycle callbacks |
| `createOne` / `createMany` / `makeOne` | instance | Convenience creators |
| `createQuietly` / `createManyQuietly` | instance | Create without model events |
| `for` / `has` / `hasAttached` | instance | belongsTo, hasMany/morphMany and belongsToMany relationships |
| `@HasFactory(...)` | `@bunyad/orm` | Bind `Model.factory()` |
| `bunyad make:factory` | CLI | Stub under `database/factories` |
