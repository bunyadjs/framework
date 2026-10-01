#!/usr/bin/env bun
/**
 * Summarize newest suite JSON under benchmarks/results/ as markdown tables.
 * Does not invent numbers — only reads existing result files.
 *
 * Usage:
 *   bun benchmarks/scripts/summarize-results.ts
 *   bun benchmarks/scripts/summarize-results.ts --suite competitors
 *   bun benchmarks/scripts/summarize-results.ts --suite competitors --scenario static-hello
 *   bun benchmarks/scripts/summarize-results.ts --list
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkResult } from "../lib/result-schema.ts";

const RESULTS = join(import.meta.dir, "..", "results");

function parseArgs(argv: string[]) {
  let suite: string | null = null;
  let scenario: string | null = null;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") list = true;
    else if (a === "--suite") suite = argv[++i] ?? null;
    else if (a === "--scenario") scenario = argv[++i] ?? null;
  }
  return { suite, scenario, list };
}

function suiteFiles(): string[] {
  if (!existsSync(RESULTS)) return [];
  return readdirSync(RESULTS)
    .filter((f) => f.includes("__suite__") && f.endsWith(".json"))
    .sort();
}

function newestForPrefix(prefix: string): string | null {
  const matches = suiteFiles().filter((f) => f.startsWith(`${prefix}__suite__`));
  return matches.length ? matches[matches.length - 1]! : null;
}

function loadSuite(file: string): BenchmarkResult[] {
  const raw = JSON.parse(readFileSync(join(RESULTS, file), "utf8"));
  return Array.isArray(raw) ? raw : [raw];
}

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return String(Math.round(n));
}

function fmtMs(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function printTable(rows: BenchmarkResult[], title: string): void {
  console.log(`### ${title}\n`);
  if (rows.length === 0) {
    console.log("_No rows._\n");
    return;
  }
  console.log(
    "| Framework | Scenario | Req/s | Ops/s | p50 (ms) | p95 (ms) | p99 (ms) | Errors | Runtime |",
  );
  console.log(
    "|-----------|----------|------:|------:|---------:|---------:|---------:|-------:|---------|",
  );
  for (const r of rows) {
    console.log(
      `| ${r.framework} | ${r.scenario} | ${fmt(r.results.requestsPerSecond)} | ${fmt(r.results.opsPerSecond)} | ${fmtMs(r.results.p50Ms)} | ${fmtMs(r.results.p95Ms)} | ${fmtMs(r.results.p99Ms)} | ${r.results.errors} | ${r.runtime.name} ${r.runtime.version} |`,
    );
  }
  const sample = rows[0]!;
  console.log(
    `\n_Source: \`${title}\` · workload ${sample.workload.durationMs}ms × concurrency ${sample.workload.concurrency} · percentiles sampled per-request where the suite is HTTP-based, \`—\` for in-process loop suites._\n`,
  );
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(RESULTS)) {
  console.log("No benchmarks/results directory. Run a suite first.");
  process.exit(0);
}

const files = suiteFiles();
if (files.length === 0) {
  console.log(
    "No `*__suite__*.json` under benchmarks/results/. Generate from a GATE run.",
  );
  process.exit(0);
}

if (args.list) {
  console.log("Suite files (oldest → newest):\n");
  for (const f of files) console.log(`- ${f}`);
  process.exit(0);
}

const prefixes = args.suite
  ? [args.suite]
  : [
      ...new Set(
        files.map((f) => f.replace(/__suite__.*$/, "")),
      ),
    ].sort();

console.log("# Benchmark results summary\n");
console.log(
  "_Generated from local `benchmarks/results` — this-machine; unverified-for-publish unless promoted._\n",
);

for (const prefix of prefixes) {
  const file = newestForPrefix(prefix);
  if (!file) {
    console.log(`### ${prefix}\n\n_No suite file. Generate from benchmarks/results._\n`);
    continue;
  }
  let rows = loadSuite(file);
  if (args.scenario) {
    rows = rows.filter((r) => r.scenario === args.scenario);
  }
  printTable(rows, file);
}
