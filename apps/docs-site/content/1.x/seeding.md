---
title: Seeding
description: Load demo and fixture rows with seeder classes under database/seeders.
---

# Seeding

## Introduction

Seeders fill tables with starter or demo data after [migrations](/docs/1.x/migrations) have built the schema. Classes live in `database/seeders`. A default `DatabaseSeeder` can call other seeders so you control order without one giant file.

You insert with models, the query builder (`DB` from `@bunyad/database`), or factories from `@bunyad/orm`. Connection and query details live under [database](/docs/1.x/database). Run seeders through the [console](/docs/1.x/console) (`bunyad db:seed`) or after `migrate:fresh --seed`.

## Writing seeders

```shell
bunyad make:seeder UserSeeder
```

Creates `database/seeders/UserSeeder.ts`. The class name always ends in `Seeder`. `--force` overwrites an existing file.

A seeder extends `Seeder` from `@bunyad/database` and implements `run`:

```ts
import { Seeder } from "@bunyad/database";
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.firstOrCreate(
      { email: "admin@example.com" },
      {
        name: "Admin",
        password: await Hash.make("secret"),
      },
    );
  }
}
```

The class must be the **default export**. `db:seed` imports `database/seeders/<Name>.ts` and constructs that export.

### Query builder inserts

When you do not need a model:

```ts
import { DB, Seeder } from "@bunyad/database";
import { Hash } from "@bunyad/auth";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await DB.table("users").insert({
      name: "Ada",
      email: "ada@example.com",
      password: await Hash.make("secret"),
    });
  }
}
```

## Using model factories

Factories live under `database/factories`. Generate one with `bunyad make:factory UserFactory`, then bind it on the model with `@HasFactory`:

```ts
import { HasFactory, Model } from "@bunyad/orm";
import UserFactory from "../../database/factories/UserFactory.ts";

@HasFactory(UserFactory)
export default class User extends Model {
  // ...
}
```

In a seeder:

```ts
import { Seeder } from "@bunyad/database";
import User from "@/Models/User.ts";

export default class UserSeeder extends Seeder {
  async run(): Promise<void> {
    await User.factory().count(50).create();
  }
}
```

`make` builds in-memory models. `create` persists them. Pass attribute overrides to either method.

## Calling additional seeders

`call` runs another seeder class:

```ts
import { Seeder } from "@bunyad/database";
import UserSeeder from "./UserSeeder.ts";
import PostSeeder from "./PostSeeder.ts";

export default class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await this.call(UserSeeder);
    await this.call(PostSeeder);
  }
}
```

`call` constructs the class and awaits `run`. Order is the order of your `await this.call(...)` lines.

## Running seeders

```shell
bunyad db:seed
```

Boots the application, loads `database/seeders/DatabaseSeeder.ts`, and runs it. On success it prints `Database seeded: DatabaseSeeder`.

Run a specific class:

```shell
bunyad db:seed --class UserSeeder
```

The value after `--class` is the filename without `.ts` (for example `UserSeeder` → `database/seeders/UserSeeder.ts`).

### Fresh migrate and seed

```shell
bunyad migrate:fresh --seed
```

Drops all tables, re-runs migrations, then runs `DatabaseSeeder`. There is no separate `--seeder=` flag on `migrate:fresh`; seed a different class with `db:seed --class` afterward.

```shell
bunyad db:wipe --seed
```

Wipes tables, then runs `migrate` and `db:seed`.

Seeders are not prompted for confirmation in production. Treat `db:seed`, `migrate:fresh --seed`, and `db:wipe --seed` as data-replacing commands and run them only where that is intended.
