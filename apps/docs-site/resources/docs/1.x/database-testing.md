---
title: Database Testing
description: Refresh migrations between tests and seed models with factories.
---

# Database Testing

## Introduction

Feature tests that touch the database need a clean schema and predictable rows. `@bunyad/testing` gives you `refreshDatabase` (wipe + migrate, optional seed). Model factories from `@bunyad/orm` build attributes for inserts. There are no `assertDatabaseHas`-style helpers yet — query with the ORM or the query builder and assert with Bun’s `expect`.

## Refreshing the database

Pass `migrationsPath` when you create the client so tables reset after boot:

```ts
@testCase({
  createApplication,
  migrationsPath: "./database/migrations",
  seed: async () => {
    await new DatabaseSeeder().run();
  },
  beforeBoot() {
    process.env.DATABASE_PATH = "./storage/testing.sqlite";
  },
})
class OrderTest extends TestCase {
  // ...
}
```

Or call it from a test / `setUp`:

```ts
await this.refreshDatabase("./database/migrations", {
  seed: async () => {
    await new DatabaseSeeder().run();
  },
});
```

Standalone helper (when you are not using `TestCase`):

```ts
import { refreshDatabase } from "@bunyad/testing";
import { Model } from "@bunyad/orm";

await refreshDatabase({
  connection: Model.getConnection(),
  migrationsPath: "./database/migrations",
  fresh: true, // wipe then migrate (default)
  seed: async () => {
    // ...
  },
});
```

Set `fresh: false` to run pending migrations only, without wiping.

## Model factories

Define a factory, attach it with `@HasFactory`, then `create` / `make` in the test:

```ts
import User from "@/Models/User.ts";

const user = await User.factory().create({
  email: "ada@example.com",
});

const unsaved = User.factory().make({ name: "Ada" });
```

Full factory API: [ORM factories](/docs/1.x/orm-factories).

## Seeders

Pass a `seed` callback to `refreshDatabase` / `@testCase`, or call a seeder after refresh:

```ts
import DatabaseSeeder from "../../database/seeders/DatabaseSeeder.ts";

await this.refreshDatabase("./database/migrations", {
  seed: () => new DatabaseSeeder().run(),
});
```

See [Seeding](/docs/1.x/seeding).

## Asserting rows

Query the model (or connection) and use Bun’s matchers:

```ts
import { expect } from "bun:test";
import User from "@/Models/User.ts";

await this.postJson("/register", {
  name: "Ada",
  email: "ada@example.com",
  password: "secret",
});

const user = await User.where("email", "ada@example.com").first();
expect(user).not.toBeNull();
expect(user!.name).toBe("Ada");

expect(await User.count()).toBe(1);
```

Soft deletes: reload with `withTrashed()` or check `trashed()` on the instance after `delete()`.
