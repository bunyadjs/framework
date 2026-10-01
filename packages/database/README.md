# @bunyad/database

Shared query builder, schema, migrator, and dual-runtime drivers (Bun + Node).

## Runtimes

| Condition | Entry | Drivers |
|---|---|---|
| `"bun"` | `src/index.bun.ts` | `bun:sqlite`, Bun `SQL` |
| `"node"` / default | `src/index.node.ts` | `pg` Pool, `mysql2`, `better-sqlite3`, `mssql` |

Optional peers: `pg`, `mysql2`, `better-sqlite3`, `bcrypt` (preferred) / `bcryptjs` (fallback). Missing peers fail fast with install hints.

## Env / connection URL parity

Bun and Node share `configFromEnv` / `connectFromEnv`:

- `DB_CONNECTION` — `sqlite` \| `pgsql` \| `mysql` \| `mariadb` \| `sqlsrv`
- `DATABASE_URL` / `DB_URL` — full connection URL when set
- `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`
- Tests: `BUNYAD_TEST_POSTGRES_URL` (live-PG gate); `BUNYAD_TEST_MYSQL_URL` (live-MySQL gate)


## Platform hooks

Password (`hashed` cast) and migrator glob resolve Bun vs Node at runtime via `platforms/`.
Do not call `close()` / `pool.end()` while a transaction still holds a reserved client.


## Nest / Next glue (Phase 5)

- NestJS: in-monorepo `@bunyad/nestjs` — `BunyadOrmModule.forRoot` / `forRootAsync` (optional Nest peers).
- Next.js: `docs/examples/orm-node-next` — `"server-only"` + one shared pool; Edge out of scope.

## Dual-runtime CI

- Bun: `bun test` (existing package suites).
- Node: `bun run --cwd packages/database test:node` or `./scripts/ci-node-orm.sh`.
- Live gates: `BUNYAD_TEST_POSTGRES_URL`, `BUNYAD_TEST_MYSQL_URL` (skips when unset/unreachable).
