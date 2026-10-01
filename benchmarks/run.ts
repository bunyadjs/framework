#!/usr/bin/env bun
/**
 * Slim gate: framework compare + ORM compare only (PLAN.md).
 *
 * Usage: bun benchmarks/run.ts
 *        bun run bench
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { GATE, ORM_COMPARE } from "./config/default.ts";
import { formatFingerprintLine } from "./lib/fingerprint.ts";

const root = resolve(import.meta.dir, "..");

const BENCH_ENV_KEYS = [
  "SEED",
  "ITERATIONS",
  "PAGE",
  "DURATION_MS",
  "CONCURRENCY",
  "WARMUP",
] as const;

type Suite = {
  name: string;
  file: string;
  env: Record<string, string>;
};

const suites: Suite[] = [
  {
    name: "Framework compare — Bunyad / Elysia / Hono / Fastify",
    file: "competitors/compare.ts",
    env: {
      DURATION_MS: String(GATE.durationMs),
      CONCURRENCY: String(GATE.concurrency),
    },
  },
  {
    name: "ORM compare — Bunyad / Prisma / Drizzle",
    file: "orm/compare.ts",
    env: {
      SEED: String(ORM_COMPARE.seed),
      ITERATIONS: String(ORM_COMPARE.iterations),
      PAGE: String(ORM_COMPARE.page),
      WARMUP: String(ORM_COMPARE.warmup),
    },
  },
];

function runSuite(suite: Suite): number {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of BENCH_ENV_KEYS) {
    delete env[key];
  }
  Object.assign(env, suite.env);

  console.log(`\n======== ${suite.name} ========`);
  console.log(`file: benchmarks/${suite.file}`);
  console.log(
    `env: ${Object.entries(suite.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );

  const result = spawnSync("bun", [resolve(import.meta.dir, suite.file)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

function main(): void {
  console.log(formatFingerprintLine());
  console.log("Slim benchmark gate (framework + ORM compares only)\n");

  let failed = 0;
  for (const suite of suites) {
    const code = runSuite(suite);
    if (code !== 0) {
      console.error(`\nSuite failed (${code}): ${suite.name}`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} suite(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll slim gate suites finished.");
}

main();
