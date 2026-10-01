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

`create` merges definition attributes with overrides and calls `Model.create` (fillable / guarded / casts / events apply as usual):

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

The base `Factory` API is `definition`, `model`, `count`, `make`, `create`, and `new`. There is no built-in `state()` chain — compose overrides at the call site.

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
| `create(attrs?)` | instance | Persisted model(s) via `Model.create` |
| `@HasFactory(...)` | `@bunyad/orm` | Bind `Model.factory()` |
| `bunyad make:factory` | CLI | Stub under `database/factories` |
