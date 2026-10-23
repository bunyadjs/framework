---
title: Using the ORM Outside Bunyad
description: Run @bunyad/orm with Next.js, Express, plain Node, or Bun servers without booting the full Bunyad application.
---

# Using the ORM Outside Bunyad

## Introduction

`@bunyad/orm` is an Eloquent-style model layer. It does **not** require the Bunyad HTTP stack, routing, views, or a generated starter. The same model classes work inside a Bunyad app and inside Next.js, Express, Hono, Elysia, or a plain Bun/`node` script.

What you need:

1. `@bunyad/orm` and `@bunyad/database`
2. A [connection](/docs/1.x/database) opened with `connect` / `connectSqlite` / `connectFromEnv`
3. `Model.setConnection(connection)` once (or Nest’s `BunyadOrmModule`, which does that for you)
4. On **Node**, only the optional peer for the driver you use

This page is the framework cookbook. For model APIs themselves, start with [ORM](/docs/1.x/orm). For installing any `@bunyad/*` package without a starter, see [using packages alone](/docs/1.x/standalone).

## Packages and peers

| Package | Role |
|---------|------|
| `@bunyad/orm` | Models, relations, casts |
| `@bunyad/database` | Connections, query builder, schema, migrator |

`@bunyad/database` resolves Bun vs Node drivers through package export conditions (`"bun"` → Bun drivers; `"node"` / default → Node drivers). See ADR-007 in the repo (`docs/decisions/ADR-007-dual-runtime-database-drivers.md`).

### Optional Node peers

Install **only** what you open. Unused engines are not required.

| Driver on Node | Peer to install |
|----------------|-----------------|
| SQLite | `better-sqlite3` |
| PostgreSQL | `pg` |
| MySQL / MariaDB | `mysql2` |
| SQL Server | `mssql` (already a normal dependency of `@bunyad/database`) |

If you use the ORM `hashed` cast on Node, also install `bcrypt` (preferred) or `bcryptjs`.

On **Bun**, SQLite uses `bun:sqlite` and Postgres/MySQL use Bun’s SQL client — you do not need `better-sqlite3` / `pg` / `mysql2` unless you deliberately run the Node entry.

Missing peers fail fast when that driver is opened, with an install hint. They are not required at import time for other drivers.

### Until packages are published

Point at the monorepo with a file dependency or workspace path:

```json title="package.json"
{
  "type": "module",
  "dependencies": {
    "@bunyad/orm": "file:../Bunyad/packages/orm",
    "@bunyad/database": "file:../Bunyad/packages/database"
  }
}
```

Inside the Bunyad repo, use `"workspace:*"`.

## Shared pattern (any framework)

Every integration follows the same three steps.

```ts
import { connect, connectSqlite, setDefaultConnection } from "@bunyad/database";
import { Model } from "@bunyad/orm";

// 1. Open one connection (or pool) for the process
const connection = connectSqlite({ path: ":memory:" });
// or: connect({ driver: "postgres", url: process.env.DATABASE_URL, max: 10 })
// or: connectFromEnv()

// 2. Point models at it
Model.setConnection(connection);
// setDefaultConnection(connection) is also fine; Model.setConnection does both

// 3. Use models as usual
class User extends Model {
  declare id: number;
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

const users = await User.query().limit(10).get();
```

Prefer **one shared connection** for the process. Do not open a new pool on every HTTP request.

Close on graceful shutdown when the process is long-lived:

```ts
await connection.close();
```

Do not call `close()` while a transaction still holds a reserved client.

## Bunyad application

In a generated Bunyad app you usually configure `config/database.ts` and let `DatabaseServiceProvider` register connections. Models use the default connection without calling `Model.setConnection` yourself.

See [Database: Getting Started](/docs/1.x/database) and [ORM](/docs/1.x/orm).

## Bun alone (scripts, Bun.serve, Hono, Elysia)

Bun can import `@bunyad/orm` directly. Open SQLite with `connectSqlite`, or Postgres/MySQL through `connect({ driver: "postgres" | "mysql", ... })`.

### Minimal script

```ts title="seed.ts"
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite({ path: "database/app.sqlite" });
Model.setConnection(connection);

await schemaFor(connection).create("users", (table) => {
  table.id();
  table.string("email").unique();
  table.timestamps();
});

class User extends Model {
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

await User.create({ email: "ada@example.com" });
console.log(await User.all());
await connection.close();
```

```shell
bun seed.ts
```

### Bun.serve

```ts title="server.ts"
import { connectSqlite } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite({ path: "database/app.sqlite" });
Model.setConnection(connection);

class User extends Model {
  declare id: number;
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/users") {
      const users = await User.query().limit(50).get();
      return Response.json(users);
    }
    return new Response("Not Found", { status: 404 });
  },
});
```

You can combine this with `@bunyad/router` on `Bun.serve` — see [using packages alone](/docs/1.x/standalone#router-on-bunserve).

### Hono or Elysia on Bun

Create the connection once at module load, call `Model.setConnection`, then use models inside route handlers. The ORM does not depend on Hono or Elysia types.

```ts title="app.ts"
import { Hono } from "hono";
import { connectSqlite } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite({ path: "database/app.sqlite" });
Model.setConnection(connection);

class User extends Model {
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

const app = new Hono();

app.get("/users", async (c) => {
  const users = await User.query().limit(50).get();
  return c.json(users);
});

export default app;
```

## Express (Node)

Express runs on Node, so install a Node driver peer (`better-sqlite3`, `pg`, or `mysql2`).

A full runnable example lives in the repo at `docs/examples/orm-node-express`.

```shell
npm i express @bunyad/orm @bunyad/database better-sqlite3
# Postgres instead: npm i pg   and use connect({ driver: "postgres", url: ... })
```

```ts title="server.ts"
import express from "express";
import { connectSqlite } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite({ path: "database/app.sqlite" });
Model.setConnection(connection);

class User extends Model {
  declare id: number;
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

const app = express();

app.get("/users", async (_req, res, next) => {
  try {
    const users = await User.query().limit(50).get();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

const server = app.listen(3000);

async function shutdown() {
  server.close();
  await connection.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
```

Use the same pattern with Fastify or Koa: one shared connection, models in handlers, close on process exit.

## Next.js (Node App Router)

Use Bunyad ORM from **server code only**: Route Handlers, Server Actions, and Server Components that never ship to the client. **Edge runtime is out of scope** (native Node drivers).

A copyable example lives in the repo at `docs/examples/orm-node-next`.

```shell
npm i @bunyad/orm @bunyad/database server-only pg
# or mysql2 / better-sqlite3
```

```ts title="lib/db.ts"
import "server-only";

import {
  connect,
  connectFromEnv,
  setDefaultConnection,
  DatabaseManager,
  type Connection,
} from "@bunyad/database";
import { Model } from "@bunyad/orm";

const globalForBunyad = globalThis as typeof globalThis & {
  __bunyadConnection?: Connection;
};

function createConnection(): Connection {
  if (
    process.env.DATABASE_URL ||
    process.env.DB_URL ||
    process.env.DB_CONNECTION
  ) {
    return connectFromEnv();
  }
  return connect({
    driver: "postgres",
    url: process.env.DATABASE_URL,
    max: 10,
  });
}

export function getConnection(): Connection {
  if (!globalForBunyad.__bunyadConnection) {
    globalForBunyad.__bunyadConnection = createConnection();
    setDefaultConnection(globalForBunyad.__bunyadConnection);
    Model.setConnection(globalForBunyad.__bunyadConnection);
  }
  return globalForBunyad.__bunyadConnection;
}

export function db(): DatabaseManager {
  return new DatabaseManager(getConnection());
}
```

```ts title="app/api/users/route.ts"
import { getConnection } from "@/lib/db";
import { Model } from "@bunyad/orm";

export const runtime = "nodejs";

class User extends Model {
  declare email: string;
  static table = "users";
  static fillable = ["email"] as const;
}

export async function GET() {
  getConnection(); // ensure singleton + Model.setConnection
  const users = await User.query().limit(50).get();
  return Response.json(users);
}
```

Rules:

1. Put `import "server-only"` in the DB module so a client import fails the build.
2. Set `export const runtime = "nodejs"` on routes that use the ORM.
3. Reuse one module-level connection (the `globalThis` pattern survives Next hot reload in development).

## Environment variables

Bun and Node share the same env helpers (`connectFromEnv` / `configFromEnv`):

| Variable | Meaning |
|----------|---------|
| `DB_CONNECTION` | `sqlite` \| `pgsql` \| `mysql` \| `mariadb` \| `sqlsrv` |
| `DATABASE_URL` / `DB_URL` | Full connection URL when set |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | Discrete fields |
| `BUNYAD_TEST_POSTGRES_URL` | Live Postgres tests |
| `BUNYAD_TEST_MYSQL_URL` | Live MySQL tests |

## How to test the dual-runtime stack

From a Bunyad checkout:

```shell
# Bun suites
bun test packages/database packages/orm

# Node driver + whereHas suite (live PG/MySQL skip without URLs)
bun run --cwd packages/database test:node

# Combined helper
./scripts/ci-node-orm.sh

# Optional live gates
BUNYAD_TEST_POSTGRES_URL=postgres://… bun run --cwd packages/database test:node
BUNYAD_TEST_MYSQL_URL=mysql://… bun run --cwd packages/database test:node
```

## What this is not

- Porting Bunyad routing, views, Live, or the full HTTP kernel into Nest/Next/Express
- A Nest `@Entity()` / TypeORM-style API — keep Bunyad `Model` classes
- Edge / Cloudflare Workers with native `pg` / `mysql2` / `better-sqlite3`
- Requiring every optional peer when you only use SQLite

## Related

- [ORM](/docs/1.x/orm)
- [Database: Getting Started](/docs/1.x/database)
- [Query Builder](/docs/1.x/queries)
- [Using Packages Alone](/docs/1.x/standalone)
- Repo: `docs/examples/orm-node-next`, `docs/examples/orm-node-express`, `docs/ORM_NODEJS_SUPPORT_PLAN.md`
