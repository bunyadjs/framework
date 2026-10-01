# Next.js (Node) — Bunyad ORM server-only example

Phase 5 glue for using `@bunyad/orm` + `@bunyad/database` (Node drivers) from
**Next.js App Router server code only**. Edge runtime is **out of scope**.

## Rules

1. Import the shared DB module only from Route Handlers, Server Actions, or
   Server Components that never ship to the client.
2. Put `"server-only"` at the top of the DB module so a client import fails the build.
3. Prefer **one shared connection/pool** (module singleton). Do **not** open a
   new pool per request.
4. Install the Node peer for your driver (`pg`, `mysql2`, or `better-sqlite3`).

## Files

| File | Role |
|------|------|
| [`db.ts`](./db.ts) | Shared `connect` + `"server-only"` guard |
| [`app/api/users/route.ts`](./app/api/users/route.ts) | Example Route Handler |
| [`package.snippet.json`](./package.snippet.json) | Suggested dependencies |

Copy these into a Next.js app (e.g. `lib/db.ts`, `app/api/users/route.ts`).

## Env

Same as Bun / Nest — see `@bunyad/database` README and ADR-007:

- `DATABASE_URL` / `DB_URL` or `DB_HOST` / `DB_PORT` / `DB_DATABASE` / …
- `DB_CONNECTION=pgsql` (or mysql / sqlite / …)

## Non-goals

- Full Bunyad HTTP / views inside Next
- Edge / middleware DB access
- Nest `@Entity()`-style models (use Bunyad `Model` classes)
