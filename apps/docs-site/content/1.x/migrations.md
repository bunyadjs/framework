---
title: Migrations
description: Version your schema with TypeScript migration files and the Schema builder.
---

# Migrations

## Introduction

Migrations are version control for your database schema. Each file under `database/migrations` describes one change — create a table, add a column, drop an index — and Bunyad records which files have already run. Teammates and deploys apply the same files instead of hand-editing production.

You write migrations against the `Schema` builder from `@bunyad/database`. Column types are logical; each driver (SQLite, MySQL, MariaDB, Postgres, SQL Server) renders its own SQL. Connection setup lives under [database](/docs/1.x/database). The [console](/docs/1.x/console) entry `bunyad` runs the migrate commands below.

## Generating migrations

```shell
bunyad make:migration create_flights_table
```

That writes `database/migrations/<timestamp>_create_flights_table.ts`. The timestamp prefix sets run order. Names that match `create_<table>_table` get a create stub for that table. Any other name gets an alter stub with `schema.table(...)`.

```shell
bunyad make:migration add_airline_to_flights_table
```

`--force` overwrites an existing file at the same path.

## Migration structure

A migration exports `up` and usually `down`. Both receive a `Schema` bound to the connection the migrator is using:

```ts
import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("flights", (table) => {
    table.id();
    table.string("name");
    table.string("airline");
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("flights");
}
```

`up` applies the change. `down` reverses it for rollback. `down` is optional; if it is missing, rollback still removes the row from the migrations table and skips calling `down`.

Only `*.ts` files in the migrations directory are loaded. Files are sorted by name before they run. The filename (for example `2026_07_26_000000_create_users_table.ts`) is what gets stored as the applied migration name.

## Running migrations

```shell
bunyad migrate
```

Pending files run in order. Each successful file is recorded in a `migrations` table (`migration` + `batch`). One `bunyad migrate` invocation shares a batch number across every file it applies. When there is nothing pending, the command prints `Nothing to migrate.`

```shell
bunyad migrate:status
```

Prints each file and either `Batch N` or `Pending`.

### Custom path

`--path=` selects a directory relative to the application root (default `database/migrations`):

```shell
bunyad migrate --path=database/migrations/tenant
bunyad migrate:status --path=database/migrations/tenant
```

The same flag works on `migrate:rollback` and `migrate:fresh`.

### Rolling back

```shell
bunyad migrate:rollback
```

Rolls back the latest batch: for each migration in that batch (filename descending), it calls `down` when present, then deletes the tracking row.

```shell
bunyad migrate:rollback --step=2
```

Rolls back two batches.

### Fresh and wipe

```shell
bunyad migrate:fresh
```

Drops every user table, then re-runs all migrations. Destructive — local and test databases only unless you accept losing data.

```shell
bunyad migrate:fresh --seed
```

After a fresh migrate, runs `db:seed` (the `DatabaseSeeder` class). See [seeding](/docs/1.x/seeding).

```shell
bunyad db:wipe
```

Drops every user table and stops. With `--seed`, wipe then runs `migrate` and `db:seed`.

### Boot-time migrate

`DatabaseServiceProvider` also runs pending migrations when the application boots. By default it migrates the default connection. Set `migrate` in `config/database.ts` to a list of connection names when you need more than one:

```ts
export default {
  default: process.env.DB_CONNECTION ?? "sqlite",
  migrate: ["sqlite", "secondary"],
  connections: {
    // ...
  },
};
```

Use `bunyad migrate` when you want explicit CLI output; boot migrate keeps a process's schema current without a separate step.

## Tables

### Creating tables

```ts
await schema.create("users", (table) => {
  table.id();
  table.string("email").unique();
  table.timestamps();
});
```

Columns on a create blueprint default to `NOT NULL` unless you call `nullable()`.

### Updating tables

```ts
await schema.table("users", (table) => {
  table.string("nickname").nullable();
  table.renameColumn("name", "full_name");
  table.dropColumn("legacy_flag");
});
```

New columns on an alter blueprint default to nullable. SQLite cannot add foreign keys through `ALTER TABLE`; declare them in `create()`, or use `schema.raw()`.

### Renaming and dropping tables

```ts
await schema.rename("posts", "articles");
await schema.drop("articles");
await schema.dropIfExists("articles");
```

## Columns

### Available column types

| Method | Purpose |
| --- | --- |
| `id(name?)` | Bigint auto-increment primary key (default column `id`) |
| `increments(name?)` | Integer auto-increment primary key |
| `bigIncrements(name?)` | Same as `id()` |
| `uuid(name)` | UUID column |
| `foreignId(name)` | Unsigned big integer (typically a foreign key) |
| `string(name, length?)` | String; default length `255` |
| `char(name, length?)` | Fixed-length character |
| `text` / `mediumText` / `longText` | Text |
| `integer` / `smallInteger` / `bigInteger` / `unsignedBigInteger` | Integers |
| `boolean(name)` | Boolean |
| `date` / `time` / `year` | Date parts |
| `timestamp` / `timestampTz` | Timestamp; `Tz` is with time zone where the driver supports it |
| `dateTime` / `dateTimeTz` | Date-time |
| `json(name)` | JSON (`JSONB` on Postgres) |
| `decimal(name, precision?, scale?)` | Decimal; defaults `8`, `2` |
| `float` / `double` | Floating point |
| `enum(name, values)` | Enum of string values |
| `binary(name)` | Binary |
| `timestamps()` / `timestampsTz()` | Nullable `created_at` / `updated_at` (ORM fills them when `Model.timestamps` is on) |
| `softDeletes(column?)` | Nullable timestamp; default `deleted_at` |
| `rememberToken()` | Nullable `remember_token` string(100) |
| `morphs(name)` / `nullableMorphs(name)` | `{name}_type` + `{name}_id` |
| `primary(columns)` | Table-level primary key (composite when you pass an array) |

### Column modifiers

Chain these on a column builder:

```ts
table.string("email").unique();
table.string("phone").nullable().default(null);
table.timestamp("published_at").useCurrent();
table.integer("score").default(0).notNullable();
table.string("code").defaultRaw("gen_random_uuid()");
```

| Method | Effect |
| --- | --- |
| `nullable(value?)` | Allow `NULL` (default `true` when called) |
| `notNullable()` | Disallow `NULL` |
| `default(value)` | Quoted default (`string` / `number` / `boolean` / `null`) |
| `defaultRaw(sql)` | Unquoted SQL default expression |
| `useCurrent()` | Current-timestamp default |
| `primary()` | Mark the column as primary |
| `unique(nameOrBoolean?)` | Unique constraint; pass a string for a named unique index |
| `index(name?)` | Non-unique index on this column |
| `constrained(table?, column?)` | Foreign key; table defaults from `*_id` → plural table name; column defaults to `id` |
| `cascadeOnDelete` / `restrictOnDelete` / `nullOnDelete` / `noActionOnDelete` | `ON DELETE` action (calls `constrained()` first if needed) |
| `cascadeOnUpdate` / `restrictOnUpdate` / `nullOnUpdate` / `noActionOnUpdate` | `ON UPDATE` action |
| `onDelete(action)` / `onUpdate(action)` | Arbitrary action string |

### Renaming and dropping columns

```ts
await schema.table("users", (table) => {
  table.renameColumn("from", "to");
  table.dropColumn("obsolete");
});
```

There is no `change()` path to alter an existing column's type in place. Add a new column, migrate data, then drop the old one — or run driver-specific SQL with `schema.raw()`.

## Indexes

```ts
await schema.create("users", (table) => {
  table.id();
  table.string("email");
  table.string("phone").nullable();
  table.unique("email", "users_email_unique");
  table.unique("phone", "users_phone_unique").where("phone IS NOT NULL");
  table.index(["email", "phone"], "users_email_phone_index");
});
```

`index` and `unique` accept a column or an array of columns, and an optional index name. On unique/index definitions, `where(sql)` builds a partial index where the driver supports it.

On an alter blueprint:

```ts
await schema.table("users", (table) => {
  table.index("email");
  table.dropIndex("users_email_index");
  table.dropUnique("users_email_unique"); // same as dropIndex
});
```

Default names follow `{table}_{columns}_{index|unique|foreign}` when you omit a name.

## Foreign keys

```ts
await schema.create("posts", (table) => {
  table.id();
  table.foreignId("user_id").constrained("users").cascadeOnDelete();
  table.string("title");
  table.timestamps();
});
```

Or the longer form:

```ts
table.unsignedBigInteger("user_id");
table.foreign("user_id").references("id").on("users").cascadeOnDelete();
```

`ForeignKeyDefinition` also supports `onUpdate`, `cascadeOnUpdate`, `restrictOnUpdate`, `nullOnUpdate`, and `noActionOnUpdate`.

## Inspecting schema

```ts
await schema.hasTable("users");
await schema.hasColumn("users", "email");
await schema.hasColumns("users", ["email", "password"]);
await schema.getColumnListing("users");
```

```ts
schema.getConnection().getDriverName(); // e.g. "sqlite", "pgsql"
```

## Foreign key constraints

```ts
await schema.disableForeignKeyConstraints();
// ...
await schema.enableForeignKeyConstraints();

await schema.withoutForeignKeyConstraints(async () => {
  await schema.drop("posts");
  await schema.drop("users");
});
```

Driver behavior differs (PRAGMA on SQLite, `FOREIGN_KEY_CHECKS` on MySQL/MariaDB, deferred constraints on Postgres, and the SQL Server dialect helpers). Prefer `withoutForeignKeyConstraints` so enable always runs in a `finally` block.

## Raw SQL

```ts
await schema.raw("CREATE INDEX users_email_trgm ON users USING gin (email gin_trgm_ops)");
```

For application queries outside migrations, prefer `DB.statement()` / `DB.unprepared()` from `@bunyad/database`. See [database](/docs/1.x/database).

## Running migrations from code

```ts
import {
  migrate,
  rollback,
  fresh,
  status,
  wipe,
  schemaFor,
} from "@bunyad/database";

const applied = await migrate(connection, "database/migrations");
const rolled = await rollback(connection, "database/migrations", 1);
const rows = await status(connection, "database/migrations");
await wipe(connection);
await fresh(connection, "database/migrations");

const schema = schemaFor(connection);
```

Optional third-argument `MigratorOptions` retargets the tracking table (`table`, `migrationColumn`, `batchColumn`). The CLI uses the defaults (`migrations` / `migration` / `batch`).

Compiled apps can register an in-memory list instead of scanning the filesystem:

```ts
import { setPreloadedMigrations, migrateCompiled } from "@bunyad/database";

setPreloadedMigrations([
  {
    migration: "2026_07_26_000000_create_users_table.ts",
    up: async (schema) => {
      await schema.create("users", (table) => {
        table.id();
        table.string("email");
      });
    },
    down: async (schema) => {
      await schema.dropIfExists("users");
    },
  },
]);
```

[The compiler](/docs/1.x/compiler) emits `.build/migrations.js` and calls `setPreloadedMigrations` so standalone binaries still migrate on boot.
