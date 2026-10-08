---
title: Database: Getting Started
description: Configure connections, run raw SQL with the DB facade, and wrap work in transactions.
---

# Database: Getting Started

## Introduction

Almost every application talks to a database. Bunyad gives you one connection API across supported drivers, a fluent [query builder](/docs/1.x/queries), and the [ORM](/docs/1.x/orm). Raw SQL, the builder, and models all share the same connection manager.

Supported drivers:

- SQLite
- MySQL
- MariaDB
- PostgreSQL
- Microsoft SQL Server

Configuration lives in `config/database.ts`. At boot, `DatabaseServiceProvider` registers each named connection as a lazy resolver, opens the default connection, and runs [migrations](/docs/1.x/migrations) for the connections listed under `migrate`.

```ts
import { DB } from "@bunyad/database";

const users = await DB.select("select * from users where active = ?", [1]);
```

In application code, import `DB` from `@bunyad/database`. Models and other app classes use `@/` imports (for example `@/Models/User.ts`).

You can open a connection in a script without booting the framework — see [using packages alone](/docs/1.x/standalone). For models on top of that connection, see the [ORM alone](/docs/1.x/standalone#orm) example.

## Configuration

`loadFrameworkConfig` loads `config/database.ts` when the file exists. The default export may be a plain object or a factory `(databasePath) => config`. Starters use the factory so the SQLite path can resolve under `database/`:

```ts title="config/database.ts"
import type { DatabaseConnectionsConfig } from "@bunyad/framework";

export type { DatabaseConnectionsConfig };

export default function database(
  databasePath: (path?: string) => string,
): DatabaseConnectionsConfig {
  return {
    default: process.env.DB_CONNECTION ?? "sqlite",

    connections: {
      sqlite: {
        driver: "sqlite",
        path:
          process.env.DATABASE_PATH ??
          process.env.DB_DATABASE ??
          databasePath("database.sqlite"),
      },

      mysql: {
        driver: "mysql",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      mariadb: {
        driver: "mariadb",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      pgsql: {
        driver: "pgsql",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "postgres",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      sqlsrv: {
        driver: "sqlsrv",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 1433),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "sa",
        password: process.env.DB_PASSWORD ?? "",
        encrypt: process.env.DB_ENCRYPT !== "false",
        trustServerCertificate:
          process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },
    },

    redis: {
      default: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
        database: process.env.REDIS_DB ?? "0",
      },
      cache: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
        database: process.env.REDIS_CACHE_DB ?? "1",
      },
    },
  };
}
```

| Key | Role |
| --- | --- |
| `default` | Connection name used by `DB`, the query builder, and the ORM. Usually `DB_CONNECTION`, default `sqlite`. |
| `connections` | Named driver configs. Unused names stay closed until first use. |
| `migrate` | Optional list of connection names to migrate on boot. When omitted, only `default` migrates. |
| `redis` | Redis clients for [cache](/docs/1.x/cache), [queues](/docs/1.x/queues), [session](/docs/1.x/session), and broadcasting — not SQL connections. |

`DB_CONNECTION` values `postgres`, `postgresql`, and `pgsql` all resolve to the `pgsql` connection. `mssql` and `sqlserver` resolve to `sqlsrv`.

If `config/database.ts` is missing, the framework builds the same standard set of connections from the environment and defaults `default` to SQLite.

### SQLite

SQLite stores the database in one file. Point `DATABASE_PATH` or `DB_DATABASE` at that file, or leave them unset so the starter uses `database/database.sqlite` via `databasePath`:

```ini
DB_CONNECTION=sqlite
DB_DATABASE=/absolute/path/to/database.sqlite
```

Use `:memory:` for an in-memory database (handy in tests). Foreign key constraints are enabled when the connection opens. Parent directories for a file path are created for you.

### MySQL and MariaDB

Set `DB_CONNECTION` to `mysql` or `mariadb`. Host, port, database, username, and password come from `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, and `DB_PASSWORD`. `DB_POOL_MAX` sets the Bun SQL pool size (`max`, default `10`).

MariaDB uses Bun's `mariadb` adapter. Prefer the `mariadb` connection name when that is your server.

### PostgreSQL

Set `DB_CONNECTION` to `pgsql` (or `postgres` / `postgresql`). Default port is `5432`. Username defaults to `postgres`. Connection URLs that include a Prisma-style `schema=` query parameter are sanitized before connect so Bun SQL does not pass an invalid `SET` option.

### Microsoft SQL Server

Set `DB_CONNECTION` to `sqlsrv`. Default port is `1433`. Username defaults to `sa`. Encryption and certificate trust default to on; set `DB_ENCRYPT=false` or `DB_TRUST_SERVER_CERTIFICATE=false` to change them. The SQL Server driver loads on the first query against that connection.

### Configuration using URLs

Managed databases often give you one URL instead of separate host and credential variables:

```ini
DB_URL=mysql://root:password@127.0.0.1/bunyad
```

`DB_URL` and `DATABASE_URL` are both read. When `url` is set on a MySQL, MariaDB, PostgreSQL, or SQL Server connection, that URL is used instead of the individual host fields.

### Connecting without the framework

Scripts and tests can open a connection from a config object or from `DB_*` environment variables without booting the application:

```ts
import {
  connect,
  connectFromEnv,
  configFromEnv,
  setDefaultConnection,
} from "@bunyad/database";

const connection = connectFromEnv();
// or: connect(configFromEnv())
// or: connect({ driver: "sqlite", path: ":memory:" })

setDefaultConnection(connection);
```

`connectSqlite`, `connectPostgres`, `connectMysql`, `connectMariadb`, and `connectSqlsrv` open a single driver directly when you already know the options.

## Running SQL queries

Once a default connection is registered, use the `DB` facade for raw SQL. Prefer bindings over string concatenation so values are not interpolated into the query text.

### Select

`select` runs a query and returns an array of row objects. `selectOne` returns the first row, or `null`:

```ts
import { DB } from "@bunyad/database";

const users = await DB.select<{ id: number; name: string }>(
  "select * from users where active = ?",
  [1],
);

const user = await DB.selectOne<{ id: number; name: string }>(
  "select * from users where id = ?",
  [1],
);
```

Placeholders are `?`. Bunyad rewrites them to the driver style (`$1` on PostgreSQL, `@p0` on SQL Server) before execution.

### Insert, update, and delete

`insert`, `update`, and `delete` run a statement and return the number of affected rows:

```ts
await DB.insert("insert into users (id, name) values (?, ?)", [1, "Marc"]);

const affected = await DB.update(
  "update users set votes = 100 where name = ?",
  ["Anita"],
);

const deleted = await DB.delete("delete from users where votes = 0");
```

### Statement and unprepared

Use `statement` for SQL that does not return rows. With bindings it runs through the parameterized path; without bindings it executes the SQL as written:

```ts
await DB.statement("drop table if exists users");
await DB.statement("update users set votes = ? where id = ?", [0, 1]);
```

`unprepared` always executes without bindings:

```ts
await DB.unprepared('update users set votes = 100 where name = "Dries"');
```

:::warning
Do not put user input into an unprepared statement. Prefer `statement` or `update` with `?` bindings.
:::

### Query builder entry points

For fluent queries, start from `DB.table` or a named connection's `table` method. See the [query builder](/docs/1.x/queries) and [pagination](/docs/1.x/pagination) pages:

```ts
const count = await DB.table("users").where("active", 1).count();

const rows = await DB.connection("analytics").table("events").get();
```

## Using multiple database connections

Define as many names as you need under `connections`. Access one with `DB.connection`:

```ts
const users = await DB.connection("sqlite").select(
  "select * from users where active = ?",
  [1],
);

await DB.connection("analytics").table("events").insert({ name: "click" });
```

`DB.connection()` with no argument returns the default connection. The return value is a connection that also exposes `.table(...)`.

Register extra connections at runtime when a second database is not in config:

```ts
import { connectSqlite, DB } from "@bunyad/database";

DB.addConnection("analytics", connectSqlite({ path: "analytics.sqlite" }));

// Or open only when first used:
DB.addConnectionResolver("reporting", () =>
  connectSqlite({ path: "reporting.sqlite" }),
);
```

`DB.setDefaultConnection("analytics")` changes which name `DB.select` and `DB.table` use.

Inspect the active default connection:

```ts
DB.getName();
DB.getDriverName(); // "sqlite" | "pgsql" | "mysql" | "mariadb" | "sqlsrv"
DB.getDatabaseName();
DB.getConfig("driver");
DB.getPdo(); // native Bun SQLite / Bun SQL / mssql handle
```

`DB.disconnect("analytics")` closes and forgets an open connection (resolvers remain, so the next use opens again). `DB.purge("analytics")` drops the cached handle without closing. Omit the name to apply the operation to every open connection.

## Listening for query events

`DB.listen` registers a callback that runs after each timed connection call (`run`, `get`, `all`, `exec`, and SQLite sync variants). It returns an unsubscribe function:

```ts
import { DB } from "@bunyad/database";

const stop = DB.listen((event) => {
  console.log(event.sql, event.bindings, event.timeMs);
  // event.connection — the Connection that ran the query
});

await DB.select("select * from users");
stop();
```

Register listeners from a service provider `boot` method when you want them for the whole process.

## Database transactions

`DB.transaction` runs a callback inside a transaction. If the callback throws, the work is rolled back and the error is rethrown. If it completes, the transaction commits:

```ts
import { DB } from "@bunyad/database";

await DB.transaction(async () => {
  await DB.update("update users set votes = 1");
  await DB.delete("delete from posts");
});
```

Nested `transaction` calls use savepoints. The outer commit is the one that finishes the real database transaction. Concurrent requests keep separate transaction depth, so nested savepoints do not collide across async work. On SQLite, where every request shares one connection, top-level transactions from concurrent requests queue and run one after another; a nested call inside a transaction never waits. Queries issued outside a transaction while another request's transaction is open still run on that same handle, so keep SQLite for single-process or low-concurrency apps, and use Postgres or MySQL when requests overlap.

### After commit

Queue work that should run only after a successful outermost commit:

```ts
await DB.transaction(async () => {
  await DB.update("update users set votes = 1");

  DB.afterCommit(async () => {
    // runs after the transaction commits
  });
});
```

If there is no active transaction, `afterCommit` runs the callback immediately. Nested successful commits merge their callbacks into the parent; a rollback discards them.

### Manual transactions

When you need explicit control, use `beginTransaction`, `commit`, and `rollBack`. Nesting uses the same savepoint rules as `transaction`:

```ts
await DB.beginTransaction();

try {
  await DB.update("update users set votes = 1");
  await DB.commit();
} catch (error) {
  await DB.rollBack();
  throw error;
}
```

The same methods exist on a connection instance: `DB.connection("sqlite").transaction(...)`, and so on.

## Migrations and seeding

Schema changes belong in migration files under `database/migrations`. Seeders live under `database/seeders`. `DatabaseServiceProvider` migrates the connections in `migrate` (or the default connection) during boot when migration files are present.

See [migrations](/docs/1.x/migrations) and [seeding](/docs/1.x/seeding). For model-based access on top of these connections, see [ORM](/docs/1.x/orm).
