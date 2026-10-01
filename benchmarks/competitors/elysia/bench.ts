#!/usr/bin/env bun
/**
 * Elysia competitor suite (PLAN.md Phase 5).
 * Runs Bunyad reference + Elysia on identical scenarios.
 *
 * Usage:
 *   bun benchmarks/competitors/elysia/bench.ts
 *   DURATION_MS=500 bun benchmarks/competitors/elysia/bench.ts
 */
process.env.FRAMEWORKS = "bunyad,elysia";
await import("../compare.ts");
