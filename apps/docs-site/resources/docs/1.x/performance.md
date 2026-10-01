---
title: Performance
description: Lean methodology and framework + ORM comparison results for Bunyad.
---

# Performance

Bunyad publishes **two** comparisons only:

1. **Framework** — Bunyad vs Elysia / Hono / Fastify on identical lean HTTP routes
2. **ORM** — Bunyad ORM vs Prisma / Drizzle on identical SQLite workloads (optional pure-SQL baseline for overhead context)

Source of truth: machine-readable JSON under `benchmarks/results/` in the framework repository. **Numbers are never invented** — tables below are filled from GATE suite JSON measured on this machine.

Full plan and fairness rules: `benchmarks/PLAN.md`.

## Environment (this run)

| Field | Value |
|-------|--------|
| **Date** | 2026-09-28 (PKT) |
| **Commit** | `eaf86aa` |
| **Machine** | SHAH-PC.local — Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz ×16, 64 GB RAM |
| **OS / arch** | darwin / x64 |
| **Runtime** | Bun 1.4.0 |
| **Framework GATE** | `DURATION_MS=1500`, `CONCURRENCY=32`, HTTP warmup 200 requests (in-repo concurrent `fetch`) |
| **ORM GATE** | `SEED=1000`, `ITERATIONS=500`, `PAGE=50`, `WARMUP=50` |
| **Suite JSON** | `competitors__suite__2026-09-28T13-06-56-972Z.json`, `orm-compare__suite__2026-09-28T13-07-10-396Z.json` |

Dependency versions recorded in those JSON files (framework compare): elysia@1.4.30, hono@4.13.9, fastify@5.12.5.

## Methodology (brief)

| Item | Detail |
|------|--------|
| Gate load tool | In-repo concurrent `fetch` (`benchmarks/lib/timing.ts`) |
| Publish load tool (optional) | [oha](https://github.com/hatoo/oha) — pin exact version on published tables |
| Warmup | Discarded before the timed window / timed iterations |
| Fingerprint | CPU, cores, RAM, OS/arch, runtime, dependency versions in every JSON result |
| Framework scenarios | `static-hello`, `param-route-id`, `middleware-0`, `middleware-1` |
| ORM legs | `find-by-id`, `where-limit`, `insert`, `update`, `belongs-to-eager`, `paginate` |

### Fairness

- Same machine and load-tool settings for any comparison table
- Identical routes and JSON payloads across frameworks
- Match functionality — never bare competitor vs feature-rich Bunyad
- Identical schema, seed size, and query intent across ORMs
- Precise claims only (no “fastest framework” without methodology)

### Reproduce

```bash
bun install
cd benchmarks/competitors && bun install && cd ../..
cd benchmarks/orm && bun install && bun run prisma:generate && cd ../..

bun run bench                 # both (applies GATE defaults from benchmarks/config/default.ts)
bun run bench:competitors
bun run bench:orm
bun run bench:summarize       # markdown tables from newest suite JSON
```

## Framework comparison

Throughput (req/s), rounded from `competitors__suite__2026-09-28T13-06-56-972Z.json`. Gate: **1500 ms × concurrency 32**. Errors: 0 on every row.

| Framework | static-hello (req/s) | param-route-id | middleware-0 | middleware-1 |
|-----------|---------------------:|---------------:|-------------:|-------------:|
| Bunyad | 41564 | 41005 | 40580 | 38521 |
| Elysia | 46784 | 45069 | 47173 | 48091 |
| Hono | 45333 | 42503 | 45661 | 41041 |
| Fastify | 28267 | 29826 | 30102 | 30090 |

Latency (ms) from the same suite (per-request samples):

| Framework | Scenario | p50 | p95 | p99 |
|-----------|----------|----:|----:|----:|
| Bunyad | static-hello | 0.62 | 1.35 | 2.07 |
| Bunyad | param-route-id | 0.65 | 1.38 | 2.02 |
| Bunyad | middleware-0 | 0.64 | 1.37 | 2.06 |
| Bunyad | middleware-1 | 0.68 | 1.47 | 2.20 |
| Elysia | static-hello | 0.57 | 1.20 | 1.79 |
| Elysia | param-route-id | 0.59 | 1.24 | 1.88 |
| Elysia | middleware-0 | 0.54 | 1.17 | 1.93 |
| Elysia | middleware-1 | 0.53 | 1.14 | 1.90 |
| Hono | static-hello | 0.59 | 1.24 | 1.93 |
| Hono | param-route-id | 0.62 | 1.33 | 2.11 |
| Hono | middleware-0 | 0.58 | 1.23 | 1.94 |
| Hono | middleware-1 | 0.64 | 1.39 | 2.05 |
| Fastify | static-hello | 0.95 | 2.09 | 3.02 |
| Fastify | param-route-id | 0.93 | 1.90 | 2.82 |
| Fastify | middleware-0 | 0.90 | 1.89 | 2.85 |
| Fastify | middleware-1 | 0.91 | 1.89 | 2.72 |

## ORM comparison

Ops/sec per leg, rounded from `orm-compare__suite__2026-09-28T13-07-10-396Z.json`. Gate: **SEED=1000, ITERATIONS=500, PAGE=50, WARMUP=50**. Errors: 0 on every row. Pure SQL is an overhead baseline, not a product winner.

| ORM | find-by-id | where-limit | insert | update | belongs-to-eager | paginate |
|-----|-----------:|------------:|-------:|-------:|-----------------:|---------:|
| Bunyad ORM | 69199 | 14422 | 1038 | 773 | 10749 | 14095 |
| Prisma | 3929 | 1842 | 931 | 739 | 1152 | 1527 |
| Drizzle | 10528 | 7153 | 950 | 891 | 4956 | 5881 |
| Pure SQL (baseline) | 78494 | 19564 | 1141 | 752 | 9190 | 15299 |

ORM legs are in-process iteration loops; latency percentiles are not collected (`null` in JSON).

## Claims

Prefer:

> In our benchmark environment, version X processed Y req/s (or ops/s) for workload Z.

Always link the suite script, dependency versions, environment fingerprint, and raw JSON. Re-run on the same class of machine before treating a single GATE pass as absolute truth.
