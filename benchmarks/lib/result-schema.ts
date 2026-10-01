/**
 * Machine-readable BenchmarkResult record shape.
 * Null is fine for metrics not collected yet — never invent numbers.
 */

export type RuntimeInfo = {
  name: string;
  version: string;
};

export type EnvironmentInfo = {
  cpu: string;
  cpuCores: number;
  memoryGb: number;
  os: string;
  arch: string;
};

export type WorkloadInfo = {
  durationMs: number;
  warmupMs: number;
  concurrency: number;
  iterations: number;
};

export type BenchmarkMetrics = {
  requestsPerSecond: number | null;
  opsPerSecond: number | null;
  averageLatencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  errors: number;
  memoryMb: number | null;
  cpuPercent: number | null;
  wallMs: number | null;
};

export type BenchmarkResult = {
  benchmark: string;
  scenario: string;
  framework: string;
  frameworkVersion: string | null;
  /** Exact npm dependency versions recorded for competitor / cross-framework runs. */
  dependencies?: Record<string, string>;
  runtime: RuntimeInfo;
  environment: EnvironmentInfo;
  workload: WorkloadInfo;
  results: BenchmarkMetrics;
  startedAt: string;
  finishedAt: string;
  methodology: string;
};

/** Empty metrics template — fill only what was actually measured. */
export function emptyMetrics(
  overrides: Partial<BenchmarkMetrics> = {},
): BenchmarkMetrics {
  return {
    requestsPerSecond: null,
    opsPerSecond: null,
    averageLatencyMs: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    errors: 0,
    memoryMb: null,
    cpuPercent: null,
    wallMs: null,
    ...overrides,
  };
}
