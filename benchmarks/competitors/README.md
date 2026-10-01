# Framework compare (lean)

Bunyad vs Elysia / Hono / Fastify on identical routes.

```bash
cd benchmarks/competitors && bun install
bun benchmarks/competitors/compare.ts
# or: bun run bench:competitors
```

Scenarios (PLAN.md §3): `static-hello`, `param-route-id`, `middleware-0`, `middleware-1`.

Local deps in this folder (not root workspaces).
