#!/usr/bin/env bun
/**
 * Hono competitor suite (PLAN.md Phase 5).
 * Runs Bunyad reference + Hono on identical scenarios.
 *
 * Usage:
 *   bun benchmarks/competitors/hono/bench.ts
 *   DURATION_MS=500 bun benchmarks/competitors/hono/bench.ts
 */
process.env.FRAMEWORKS = "bunyad,hono";
await import("../compare.ts");
