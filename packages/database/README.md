# @bunyad/database

Query builder, schema builder, migrations and connections for [Bunyad](https://github.com/bunyadjs/framework). One API on Node and Bun.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
npm install @bunyad/database@beta better-sqlite3   # or pg / mysql2
```

```ts
import { connectSqlite, schemaFor } from "@bunyad/database";

const connection = connectSqlite({ path: "app.sqlite" });

await schemaFor(connection).create("users", (table) => {
  table.id();
  table.string("email").unique();
  table.timestamps();
});
```

## Runtimes and drivers

| Runtime | Drivers |
|---|---|
| Bun (`"bun"` export condition) | `bun:sqlite`, Bun `SQL` (PostgreSQL, MySQL) |
| Node (default) | `better-sqlite3`, `pg`, `mysql2`, `mssql` |

Install the driver you need as a peer dependency: `better-sqlite3`, `pg` or `mysql2`. `better-sqlite3` 13 needs Node 22 or newer; use version 12 on Node 20. `bcrypt` (preferred) or `bcryptjs` is used for hashed password columns. A missing driver fails fast with an install hint.

## Connecting from the environment

`connectFromEnv()` reads:

- `DB_CONNECTION`: `sqlite`, `pgsql`, `mysql`, `mariadb` or `sqlsrv`
- `DATABASE_URL` or `DB_URL`: a full connection URL (takes precedence)
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`

Don't call `close()` or `pool.end()` while a transaction still holds a reserved client.

## Iterating large result sets

`cursor()` runs one query and yields rows as they arrive, so memory stays flat on big tables. `lazy()` and `lazyById()` page through the table with one query per chunk.

```ts
for await (const row of DB.table("orders").where("status", "open").cursor()) {
  // one row at a time
}
```

| Driver | `cursor()` |
|---|---|
| `bun:sqlite`, `better-sqlite3` | one statement, row at a time |
| Postgres (Bun SQL and `pg`) | server-side cursor, `chunkSize` rows per round trip |
| MySQL / MariaDB (`mysql2`) | one streamed query |
| MySQL / MariaDB (Bun SQL), SQL Server | no streaming primitive, so it falls back to `lazy()` |

Things to know:

- Abandoning the loop early (`break`) releases the statement, cursor or connection.
- Inside `transaction()` the stream reuses the transaction's connection and sees its writes.
- `better-sqlite3` rejects writes on the same connection while a stream is open, and `mysql2` holds a pool connection until the stream ends. If the loop body writes to the table you are reading, use `lazyById()`.

## Status

SQLite is the most tested driver. PostgreSQL and MySQL have live-database test gates (`BUNYAD_TEST_POSTGRES_URL`, `BUNYAD_TEST_MYSQL_URL`) that are skipped when unset. SQL Server support is experimental.

## License

MIT
