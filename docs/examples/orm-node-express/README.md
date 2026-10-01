# Express (Node) — Bunyad ORM example

Runnable **Express** app on **Node** using `@bunyad/orm` and `@bunyad/database`
with **SQLite** (`better-sqlite3`) for a zero-config demo.

This is ORM-only glue. It is **not** the full Bunyad HTTP stack, views, or Live.

Laravel-style static terminals (`User.get()`, `User.pluck()`, …) work on models.

## Prerequisites

- A Bunyad monorepo checkout
- [Bun](https://bun.sh) (for workspace install) and **Node 22+** (for
  `--experimental-transform-types`)

## Install

From the monorepo root:

```shell
bun install
```

That links `@bunyad/database` and `@bunyad/orm` via `workspace:*` and installs
`express` / `better-sqlite3` for this package.

## Run

```shell
bun run --cwd docs/examples/orm-node-express start
# or
npm run start --prefix docs/examples/orm-node-express
```

Development (restarts on file changes):

```shell
bun run --cwd docs/examples/orm-node-express dev
```

The server listens on `PORT` or **3000**. On first boot it creates
`database/app.sqlite`, the `users` table, and seeds two users when the table is
empty.

## Curl examples

```shell
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/users
curl -s http://127.0.0.1:3000/users/1
curl -s -X POST http://127.0.0.1:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"alan@example.com","name":"Alan Turing"}'
curl -s -X PATCH http://127.0.0.1:3000/users/1 \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada"}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:3000/users/3
```

## Environment

| Variable | Behaviour |
|----------|-----------|
| *(none)* | SQLite at `database/app.sqlite` under this example |
| `BUNYAD_SQLITE_PATH` | Custom SQLite file path |
| `DATABASE_URL` / `DB_URL` / `DB_CONNECTION` | Use `connectFromEnv()` instead of SQLite |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, … | Discrete fields for `connectFromEnv` |
| `PORT` | HTTP port (default `3000`) |

### Postgres (optional)

Install the Node peer and point env at a URL:

```shell
# from monorepo root after adding pg to this package or globally
DATABASE_URL=postgres://user:pass@localhost:5432/bunyad \
  bun run --cwd docs/examples/orm-node-express start
```

You can also call `connect({ driver: "postgres", url, max: 10 })` from
`@bunyad/database` in your own app — same pattern as Nest/Next. See
[Using the ORM Outside Bunyad](../../../apps/docs-site/resources/docs/1.x/orm-outside.md).

## Layout

| File | Role |
|------|------|
| [`src/db.ts`](./src/db.ts) | Shared connection + `Model.setConnection` |
| [`src/models/user.ts`](./src/models/user.ts) | Bunyad `User` model |
| [`src/bootstrap.ts`](./src/bootstrap.ts) | Schema + seed |
| [`src/routes/users.ts`](./src/routes/users.ts) | CRUD router |
| [`src/server.ts`](./src/server.ts) | Express entry + graceful shutdown |

## Non-goals

- Full Bunyad HTTP, routing kernel, views, or Live inside Express
- Nest `@Entity()` / Prisma schema forks — keep Bunyad `Model` classes
- Edge runtimes (native Node drivers)
