#!/usr/bin/env bun
/**
 * Compare current GATE suite JSON against optional baselines.
 *
 * Relative regression only — never invents absolute thresholds beyond
 * config/regression.ts (PLAN §26 placeholder: 10%).
 *
 * Exit codes:
 *   0 — pass, or soft-warn (no baseline / under threshold / REGRESSION_MODE=soft)
 *   1 — strict mode and regression over maxRegressionPercent
 *   2 — usage / I/O error
 *
 * Env:
 *   REGRESSION_MODE=soft|strict   (default: config.defaultMode)
 *   REGRESSION_BASELINE_DIR       (default: benchmarks/results/baselines)
 *   REGRESSION_CURRENT_DIR        (default: benchmarks/results)
 *   REGRESSION_MAX_PERCENT        (override config.maxRegressionPercent)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import regressionConfig from "../config/regression.ts";
import type { BenchmarkResult } from "../lib/result-schema.ts";

const ROOT = join(import.meta.dir, "..");
const BASELINE_DIR =
  process.env.REGRESSION_BASELINE_DIR ?? join(ROOT, "results", "baselines");
const CURRENT_DIR =
  process.env.REGRESSION_CURRENT_DIR ?? join(ROOT, "results");
const MODE = (
  process.env.REGRESSION_MODE ?? regressionConfig.defaultMode
).toLowerCase() as "soft" | "strict";
const MAX_PCT = Number(
  process.env.REGRESSION_MAX_PERCENT ?? regressionConfig.maxRegressionPercent,
);

type Row = {
  benchmark: string;
  scenario: string;
  throughput: number;
  source: string;
};

function throughputOf(r: BenchmarkResult): number | null {
  const v = r.results.requestsPerSecond ?? r.results.opsPerSecond;
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function loadSuiteFile(path: string): BenchmarkResult[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | BenchmarkResult
    | BenchmarkResult[];
  return Array.isArray(raw) ? raw : [raw];
}

/** Newest *__suite__*.json per benchmark name under dir (non-recursive except baselines flat). */
function indexSuites(dir: string): Map<string, { path: string; rows: Row[] }> {
  const out = new Map<string, { path: string; rows: Row[]; mtime: number }>();
  if (!existsSync(dir)) return new Map();

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const path = join(dir, file);
    let st;
    try {
      st = statSync(path);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    let results: BenchmarkResult[];
    try {
      results = loadSuiteFile(path);
    } catch {
      continue;
    }
    if (results.length === 0) continue;
    const benchmark = results[0]?.benchmark;
    if (!benchmark) continue;

    // Prefer explicit suite files; also accept any json keyed by benchmark.
    const isSuite = file.includes("__suite__") || !file.includes("__");
    if (!isSuite && file.includes("__")) {
      // per-scenario file — skip unless no suite exists yet
      if (out.has(benchmark)) continue;
    }

    const rows: Row[] = [];
    for (const r of results) {
      const t = throughputOf(r);
      if (t === null) continue;
      rows.push({
        benchmark: r.benchmark,
        scenario: r.scenario,
        throughput: t,
        source: path,
      });
    }
    if (rows.length === 0) continue;

    const prev = out.get(benchmark);
    if (!prev || st.mtimeMs >= prev.mtime) {
      out.set(benchmark, { path, rows, mtime: st.mtimeMs });
    }
  }

  const slim = new Map<string, { path: string; rows: Row[] }>();
  for (const [k, v] of out) slim.set(k, { path: v.path, rows: v.rows });
  return slim;
}

function main(): void {
  console.log("Regression check (relative vs baseline JSON)");
  console.log(`  mode=${MODE}  maxRegressionPercent=${MAX_PCT}`);
  console.log(`  baselines=${BASELINE_DIR}`);
  console.log(`  current=${CURRENT_DIR}\n`);

  if (!Number.isFinite(MAX_PCT) || MAX_PCT <= 0) {
    console.error("Invalid REGRESSION_MAX_PERCENT / maxRegressionPercent");
    process.exit(2);
  }

  const baselines = indexSuites(BASELINE_DIR);
  const current = indexSuites(CURRENT_DIR);

  if (baselines.size === 0) {
    console.log(
      "SOFT: no baseline suite JSON under results/baselines/.\n" +
        "  Copy a known-good *__suite__*.json there (see baselines/README.md).\n" +
        "  CI stays green until baselines exist — this is intentional.",
    );
    process.exit(0);
  }

  let worst: {
    benchmark: string;
    scenario: string;
    pct: number;
    base: number;
    cur: number;
  } | null = null;
  let compared = 0;
  const lines: string[] = [];

  for (const suiteName of regressionConfig.suites) {
    const base = baselines.get(suiteName);
    if (!base) {
      lines.push(`  skip ${suiteName}: no baseline file`);
      continue;
    }
    const cur = current.get(suiteName);
    if (!cur) {
      lines.push(`  skip ${suiteName}: no current suite in results/`);
      continue;
    }

    const curByScenario = new Map(cur.rows.map((r) => [r.scenario, r]));
    for (const b of base.rows) {
      const c = curByScenario.get(b.scenario);
      if (!c) {
        lines.push(
          `  skip ${suiteName}/${b.scenario}: missing in current suite`,
        );
        continue;
      }
      compared += 1;
      const pct = ((b.throughput - c.throughput) / b.throughput) * 100;
      const flag =
        pct > MAX_PCT ? "REGRESSION" : pct < -MAX_PCT ? "faster" : "ok";
      lines.push(
        `  ${flag.padEnd(10)} ${suiteName}/${b.scenario}: baseline ${b.throughput.toFixed(0)} → current ${c.throughput.toFixed(0)} (${pct >= 0 ? "-" : "+"}${Math.abs(pct).toFixed(1)}%)`,
      );
      if (pct > MAX_PCT && (!worst || pct > worst.pct)) {
        worst = {
          benchmark: suiteName,
          scenario: b.scenario,
          pct,
          base: b.throughput,
          cur: c.throughput,
        };
      }
    }
  }

  for (const line of lines) console.log(line);
  console.log(`\nCompared ${compared} scenario(s).`);

  if (!worst) {
    console.log("PASS: no scenario exceeded maxRegressionPercent.");
    process.exit(0);
  }

  const msg =
    `Regression ${worst.pct.toFixed(1)}% on ${worst.benchmark}/${worst.scenario} ` +
    `(baseline ${worst.base.toFixed(0)} → current ${worst.cur.toFixed(0)}; threshold ${MAX_PCT}%).`;

  if (MODE === "strict") {
    console.error(`FAIL (strict): ${msg}`);
    process.exit(1);
  }

  console.log(`SOFT-FAIL: ${msg}`);
  console.log(
    "  REGRESSION_MODE=soft (default) — warning only. Set REGRESSION_MODE=strict to fail CI.",
  );
  process.exit(0);
}

main();
