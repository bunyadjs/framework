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

Install the driver you need as a peer dependency: `better-sqlite3`, `pg` or `mysql2`. `bcrypt` (preferred) or `bcryptjs` is used for hashed password columns. A missing driver fails fast with an install hint.

## Connecting from the environment

`connectFromEnv()` reads:

- `DB_CONNECTION`: `sqlite`, `pgsql`, `mysql`, `mariadb` or `sqlsrv`
- `DATABASE_URL` or `DB_URL`: a full connection URL (takes precedence)
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`

Don't call `close()` or `pool.end()` while a transaction still holds a reserved client.

## Status

SQLite is the most tested driver. PostgreSQL and MySQL have live-database test gates (`BUNYAD_TEST_POSTGRES_URL`, `BUNYAD_TEST_MYSQL_URL`) that are skipped when unset. SQL Server support is experimental.

## License

MIT
