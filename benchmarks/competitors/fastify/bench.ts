#!/usr/bin/env bun
/**
 * Fastify competitor suite (PLAN.md Phase 5).
 * Runs Bunyad reference + Fastify on identical scenarios (Fastify under Bun).
 *
 * Usage:
 *   bun benchmarks/competitors/fastify/bench.ts
 *   DURATION_MS=500 bun benchmarks/competitors/fastify/bench.ts
 */
process.env.FRAMEWORKS = "bunyad,fastify";
await import("../compare.ts");
