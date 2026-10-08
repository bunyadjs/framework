# ORM compare

Bunyad ORM vs Prisma vs Drizzle on identical SQLite legs (optional pure-SQL baseline).

```bash
cd benchmarks/orm && bun install
bun run prisma:generate
bun benchmarks/orm/compare.ts
# or: bun run bench:orm
```

Legs: `find-by-id`, `where-limit`, `insert`, `update`, `belongs-to-eager`, `paginate`.

Env: `SEED`, `ITERATIONS`, `PAGE`, `WARMUP`, `ORMS=bunyad,prisma,drizzle,sql`.

## Bunyad-only micro-benchmarks

`bun benchmarks/orm/internal.ts` needs no extra installs. It seeds a posts/authors/tags schema and times hydration, pagination, chunking, eager loads (belongsTo / hasMany / belongsToMany / nested), relation aggregates, `whereHas`, writes, and pivot `attach` / `sync`.

Env: `ROWS` (default 10000), `ITERATIONS`, `WARMUP`, `LEGS=sync-200-of-200,attach-1000`. Set `BUNYAD_TEST_POSTGRES_URL` / `BUNYAD_TEST_MYSQL_URL` to run the same legs on those servers, where round trips dominate. MySQL 8+/9 logins with `caching_sha2_password` need TLS, so the script connects with `tls: { rejectUnauthorized: false }` (local test servers only).
