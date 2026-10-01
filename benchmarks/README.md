# Benchmarks (slim)

Two compares only — see [`PLAN.md`](PLAN.md).

1. **Framework** — Bunyad vs Elysia / Hono / Fastify (`competitors/`)
2. **ORM** — Bunyad ORM vs Prisma / Drizzle (`orm/`)

Shared harness: `lib/` (timing, fingerprint, JSON writer), `config/default.ts`.

**Never invent numbers.** Tables in docs come from `results/` JSON or stay as placeholders.

## Run

```bash
bun install
cd benchmarks/competitors && bun install && cd ../..
cd benchmarks/orm && bun install && bun run prisma:generate && cd ../..

bun run bench                 # both compares
bun run bench:competitors     # frameworks only
bun run bench:orm             # ORMs only
bun run bench:summarize       # markdown from newest suite JSON
```

## Layout

```text
benchmarks/
├── PLAN.md
├── config/
├── lib/
├── competitors/
├── orm/
├── scripts/
├── results/
└── run.ts
```
