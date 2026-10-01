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
