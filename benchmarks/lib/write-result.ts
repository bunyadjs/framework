/**
 * Persist BenchmarkResult JSON under benchmarks/results/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkResult } from "./result-schema.ts";

const RESULTS_DIR = join(import.meta.dir, "..", "results");

export function resultsDir(): string {
  return RESULTS_DIR;
}

/**
 * Write one result (or an array) as JSON.
 * Default filename: `{benchmark}__{scenario}__{ISO-stamp}.json`
 * Returns the absolute path written.
 */
export async function writeResult(
  result: BenchmarkResult | BenchmarkResult[],
  options?: { filename?: string },
): Promise<string> {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const sample = Array.isArray(result) ? result[0] : result;
  const stamp = (sample?.finishedAt ?? new Date().toISOString()).replace(
    /[:.]/g,
    "-",
  );
  const safeBench = (sample?.benchmark ?? "benchmark").replace(
    /[^a-zA-Z0-9._-]+/g,
    "-",
  );
  const safeScenario = (sample?.scenario ?? "scenario").replace(
    /[^a-zA-Z0-9._-]+/g,
    "-",
  );
  const filename =
    options?.filename ?? `${safeBench}__${safeScenario}__${stamp}.json`;
  const path = join(RESULTS_DIR, filename);

  await Bun.write(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

/** Write every result as a single suite file plus one file per scenario. */
export async function writeSuiteResults(
  results: BenchmarkResult[],
  suiteFilename?: string,
): Promise<{ suitePath: string; paths: string[] }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bench = results[0]?.benchmark ?? "suite";
  const suitePath = await writeResult(results, {
    filename: suiteFilename ?? `${bench}__suite__${stamp}.json`,
  });
  const paths: string[] = [];
  for (const r of results) {
    paths.push(await writeResult(r));
  }
  return { suitePath, paths };
}
