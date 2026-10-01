/**
 * Shared competitor comparison helpers (PLAN.md §3 — lean framework compare).
 *
 * Fairness rules:
 * - Same machine, GATE duration/concurrency, concurrent-fetch harness
 * - Identical response payloads across frameworks
 * - Match functionality (never bare competitor vs feature-rich Bunyad)
 * - Record exact dependency versions; leave percentiles null unless measured
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GATE } from "../config/default.ts";
import { collectFingerprint } from "../lib/fingerprint.ts";
import {
  emptyMetrics,
  type BenchmarkResult,
} from "../lib/result-schema.ts";
import { measureHttpDuration } from "../lib/timing.ts";

export const BENCHMARK = "competitors";

export const HELLO = { message: "Hello, World" } as const;

export const DURATION_MS = Number(process.env.DURATION_MS ?? GATE.durationMs);
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? GATE.concurrency);
export const WARMUP_HTTP = GATE.httpWarmupRequests;

/** Scenarios every framework implements with identical payloads. */
/** Lean scenario set (PLAN.md §3). Extra routes may still exist on servers. */
export const SCENARIOS = [
  {
    name: "static-hello",
    path: "/hello",
    note: "GET /hello → json({ message: 'Hello, World' })",
  },
  {
    name: "param-route-id",
    path: "/users/123",
    note: "GET /users/:id → json({ id })",
  },
  {
    name: "middleware-0",
    path: "/mw/0",
    note: "0 no-op middleware layers → hello JSON",
  },
  {
    name: "middleware-1",
    path: "/mw/1",
    note: "1 no-op middleware layer → hello JSON",
  },
] as const;

export type ScenarioName = (typeof SCENARIOS)[number]["name"];

export type CompetitorServer = {
  port: number;
  stop: () => void | Promise<void>;
};

export type FrameworkSpec = {
  id: string;
  /** Primary package version (frameworkVersion field). */
  version: string;
  /** Exact dependency versions written into JSON results. */
  dependencies: Record<string, string>;
  start: () => CompetitorServer | Promise<CompetitorServer>;
};

/** Resolve an installed package version under competitors/node_modules. */
export function competitorPackageVersion(packageName: string): string {
  const pkgPath = join(
    import.meta.dir,
    "node_modules",
    packageName,
    "package.json",
  );
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  if (!raw.version) {
    throw new Error(`No version in ${pkgPath}`);
  }
  return raw.version;
}

export function fmtOps(n: number): string {
  return Math.round(n).toLocaleString().padStart(12);
}

export async function smokeCheck(base: string, framework: string): Promise<void> {
  const hello = await (await fetch(`${base}/hello`)).json();
  if (JSON.stringify(hello) !== JSON.stringify(HELLO)) {
    throw new Error(
      `${framework} /hello mismatch: ${JSON.stringify(hello)}`,
    );
  }

  const user = await (await fetch(`${base}/users/123`)).json();
  if (user?.id !== "123") {
    throw new Error(
      `${framework} /users/123 mismatch: ${JSON.stringify(user)}`,
    );
  }

  for (const path of ["/mw/0", "/mw/1"]) {
    const body = await (await fetch(`${base}${path}`)).json();
    if (JSON.stringify(body) !== JSON.stringify(HELLO)) {
      throw new Error(
        `${framework} ${path} mismatch: ${JSON.stringify(body)}`,
      );
    }
  }
}

export function baseResult(
  framework: string,
  frameworkVersion: string | null,
  dependencies: Record<string, string> | undefined,
  scenario: string,
  startedAt: string,
  finishedAt: string,
  workload: BenchmarkResult["workload"],
  results: BenchmarkResult["results"],
  methodology: string,
): BenchmarkResult {
  const fp = collectFingerprint();
  const row: BenchmarkResult = {
    benchmark: BENCHMARK,
    scenario,
    framework,
    frameworkVersion,
    runtime: fp.runtime,
    environment: {
      cpu: fp.environment.cpu,
      cpuCores: fp.environment.cpuCores,
      memoryGb: fp.environment.memoryGb,
      os: fp.environment.os,
      arch: fp.environment.arch,
    },
    workload,
    results,
    startedAt,
    finishedAt,
    methodology,
  };
  if (dependencies && Object.keys(dependencies).length > 0) {
    row.dependencies = dependencies;
  }
  return row;
}

export async function measureScenario(
  spec: FrameworkSpec,
  scenario: (typeof SCENARIOS)[number],
  base: string,
): Promise<BenchmarkResult> {
  const startedAt = new Date().toISOString();
  const measured = await measureHttpDuration({
    url: `${base}${scenario.path}`,
    durationMs: DURATION_MS,
    concurrency: CONCURRENCY,
    warmupRequests: WARMUP_HTTP,
  });
  const finishedAt = new Date().toISOString();
  return baseResult(
    spec.id,
    spec.version,
    spec.dependencies,
    scenario.name,
    startedAt,
    finishedAt,
    {
      durationMs: DURATION_MS,
      warmupMs: 0,
      concurrency: CONCURRENCY,
      iterations: measured.ops,
    },
    emptyMetrics({
      requestsPerSecond: measured.opsPerSecond,
      errors: measured.errors,
      wallMs: measured.wallMs,
      averageLatencyMs: measured.averageLatencyMs,
      p50Ms: measured.p50Ms,
      p95Ms: measured.p95Ms,
      p99Ms: measured.p99Ms,
    }),
    `Competitor compare (${spec.id}@${spec.version}). Concurrent fetch; warmup ${WARMUP_HTTP}; measure ${DURATION_MS}ms × concurrency ${CONCURRENCY}. ${scenario.note}. Same payload as Bunyad Layer 2 equivalents. Per-request latency sampled from ${measured.ops} completed requests.`,
  );
}

/** Run all SCENARIOS against one started framework; returns measured rows. */
export async function runFrameworkScenarios(
  spec: FrameworkSpec,
): Promise<BenchmarkResult[]> {
  const server = await spec.start();
  const base = `http://127.0.0.1:${server.port}`;
  const results: BenchmarkResult[] = [];
  try {
    await smokeCheck(base, spec.id);
    for (const scenario of SCENARIOS) {
      results.push(await measureScenario(spec, scenario, base));
    }
  } finally {
    await server.stop();
  }
  return results;
}
