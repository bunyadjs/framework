/**
 * Shared benchmark configuration (slim PLAN).
 *
 * Gate suites keep short calibrated knobs.
 * Env vars always win when set on a suite process (run.ts clears parent
 * knobs then applies suite-local env).
 */

/** Standard external HTTP load generator for cross-framework comparisons. */
export const LOAD_GENERATOR = {
  tool: "oha" as const,
  /** Pin when publishing results; install: https://github.com/hatoo/oha */
  versionNote: "document `oha --version` alongside every published table",
};

/** Short in-repo gate (what `bun benchmarks/run.ts` uses). */
export const GATE = {
  /** HTTP measure window (ms). */
  durationMs: 1500,
  /** Concurrent clients for built-in fetch harness. */
  concurrency: 32,
  /** Warmup request count before HTTP measure (not a timed window). */
  httpWarmupRequests: 200,
  loopWarmupIterations: 1_000,
} as const;

/**
 * Longer publish-oriented defaults.
 * Not applied by run.ts — use when adding oha-driven HTTP suites.
 */
export const PUBLISH = {
  durationSec: 30,
  warmupSec: 10,
  concurrencyLevels: [1, 10, 50, 100, 250, 500] as const,
  runs: 5,
} as const;

/** ORM compare calibrated defaults. */
export const ORM_COMPARE = {
  seed: 1000,
  iterations: 500,
  page: 50,
  warmup: 50,
} as const;

export default {
  loadGenerator: LOAD_GENERATOR,
  gate: GATE,
  publish: PUBLISH,
  ormCompare: ORM_COMPARE,
};
