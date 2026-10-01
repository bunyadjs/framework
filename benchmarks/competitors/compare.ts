#!/usr/bin/env bun
/**
 * Lean framework compare (PLAN.md §3).
 *
 * Bunyad + Elysia + Hono + Fastify on identical scenarios:
 *   static-hello, param-route-id, middleware-0, middleware-1
 *
 * Usage:
 *   bun benchmarks/competitors/compare.ts
 *   DURATION_MS=500 CONCURRENCY=32 bun benchmarks/competitors/compare.ts
 *   FRAMEWORKS=bunyad,hono bun benchmarks/competitors/compare.ts
 *
 * Measure and report only — does not optimise Bunyad.
 * Do not invent numbers; leave unmeasured metrics null.
 */
import { collectFingerprint } from "../lib/fingerprint.ts";
import type { BenchmarkResult } from "../lib/result-schema.ts";
import { writeSuiteResults } from "../lib/write-result.ts";
import { startBunyadRefServer } from "./bunyad-ref.ts";
import { startElysiaServer } from "./elysia/server.ts";
import { startFastifyServer } from "./fastify/server.ts";
import { startHonoServer } from "./hono/server.ts";
import {
  CONCURRENCY,
  DURATION_MS,
  SCENARIOS,
  WARMUP_HTTP,
  competitorPackageVersion,
  fmtOps,
  runFrameworkScenarios,
  type FrameworkSpec,
} from "./shared.ts";

function parseFrameworkFilter(): Set<string> | null {
  const raw = process.env.FRAMEWORKS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function buildSpecs(): FrameworkSpec[] {
  const elysiaVersion = competitorPackageVersion("elysia");
  const honoVersion = competitorPackageVersion("hono");
  const fastifyVersion = competitorPackageVersion("fastify");

  return [
    {
      id: "bunyad",
      version: "0.0.0",
      dependencies: { bunyad: "0.0.0" },
      start: startBunyadRefServer,
    },
    {
      id: "elysia",
      version: elysiaVersion,
      dependencies: { elysia: elysiaVersion },
      start: startElysiaServer,
    },
    {
      id: "hono",
      version: honoVersion,
      dependencies: { hono: honoVersion },
      start: startHonoServer,
    },
    {
      id: "fastify",
      version: fastifyVersion,
      dependencies: { fastify: fastifyVersion },
      start: startFastifyServer,
    },
  ];
}

async function main(): Promise<void> {
  const fp = collectFingerprint();
  const filter = parseFrameworkFilter();
  const specs = buildSpecs().filter(
    (s) => filter === null || filter.has(s.id),
  );

  if (specs.length === 0) {
    throw new Error(
      `No frameworks matched FRAMEWORKS=${process.env.FRAMEWORKS ?? ""}`,
    );
  }

  console.log("Framework compare (lean)\n");
  console.log(
    `machine: ${fp.environment.cpu} ×${fp.environment.cpuCores} | RAM ${fp.environment.memoryGb} GB | ${fp.environment.os}/${fp.environment.arch} | Bun ${fp.runtime.version}`,
  );
  console.log(
    `HTTP  DURATION_MS=${DURATION_MS}  CONCURRENCY=${CONCURRENCY}  WARMUP=${WARMUP_HTTP}`,
  );
  console.log(
    `frameworks: ${specs.map((s) => `${s.id}@${s.version}`).join(", ")}`,
  );
  console.log(
    `scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}\n`,
  );

  const all: BenchmarkResult[] = [];

  for (const spec of specs) {
    console.log(`--- ${spec.id}@${spec.version} ---`);
    const rows = await runFrameworkScenarios(spec);
    all.push(...rows);
    for (const r of rows) {
      console.log(
        `  ${r.scenario.padEnd(28)} ${fmtOps(r.results.requestsPerSecond ?? 0)} req/s   errors ${r.results.errors}`,
      );
    }
    console.log("");
  }

  // Side-by-side table per scenario
  console.log("Comparison (req/s by scenario)\n");
  const frameworks = specs.map((s) => s.id);
  const header =
    "scenario".padEnd(28) +
    frameworks.map((f) => f.padStart(12)).join("") +
    "\n";
  console.log(header.trimEnd());
  console.log("-".repeat(header.trimEnd().length));
  for (const scenario of SCENARIOS) {
    const cells = frameworks.map((f) => {
      const row = all.find(
        (r) => r.framework === f && r.scenario === scenario.name,
      );
      const rps = row?.results.requestsPerSecond;
      return rps == null ? "n/a".padStart(12) : fmtOps(rps);
    });
    console.log(scenario.name.padEnd(28) + cells.join(""));
  }

  const { suitePath, paths } = await writeSuiteResults(all);
  console.log(
    `\nWrote ${paths.length + 1} JSON file(s) under benchmarks/results/`,
  );
  console.log(`  suite: ${suitePath}`);
  for (const p of paths) console.log(`  ${p}`);
  console.log(
    "\nDeps live under benchmarks/competitors/ (not the monorepo root).",
  );
}

await main();
