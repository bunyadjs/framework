/**
 * Shared short-bench timing helpers (warmup + measure).
 */

export async function elapsedMs(
  fn: () => void | Promise<void>,
): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

export type TimedLoopResult = {
  iterations: number;
  wallMs: number;
  opsPerSecond: number;
};

/** Fixed-iteration timed loop (after optional warmup). */
export async function measureIterations(
  iterations: number,
  fn: () => void | Promise<void>,
  warmupIterations = 0,
): Promise<TimedLoopResult> {
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }
  const wallMs = await elapsedMs(async () => {
    for (let i = 0; i < iterations; i++) {
      await fn();
    }
  });
  return {
    iterations,
    wallMs,
    opsPerSecond: (iterations / wallMs) * 1000,
  };
}

export type TimedDurationResult = {
  ops: number;
  wallMs: number;
  opsPerSecond: number;
  errors: number;
  averageLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

/** Nearest-rank percentile over an already-sorted ascending array. */
function percentileOf(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank]!;
}

/**
 * Concurrent fetch-style HTTP measure (same shape as hello-and-sqlite measureHttp).
 *
 * Records per-request wall latency during the measurement window (not warmup)
 * and derives p50/p95/p99 + average from those samples. Percentiles are
 * computed from real completed requests only — never fabricated.
 */
export async function measureHttpDuration(options: {
  url: string;
  method?: string;
  durationMs: number;
  concurrency: number;
  warmupRequests?: number;
  body?: BodyInit | null;
  headers?: HeadersInit;
}): Promise<TimedDurationResult> {
  const method = options.method ?? "GET";
  const warmup = options.warmupRequests ?? 200;
  const init: RequestInit = {
    method,
    body: options.body,
    headers: options.headers,
  };
  let errors = 0;

  async function drain(res: Response): Promise<void> {
    if (!res.ok) {
      errors += 1;
      await res.arrayBuffer().catch(() => undefined);
      return;
    }
    await res.arrayBuffer();
  }

  for (let i = 0; i < warmup; i++) {
    await drain(await fetch(options.url, init));
  }

  // Reset error count after warmup so measurement errors stand alone.
  errors = 0;
  let ops = 0;
  // Pre-sized growable latency buffer — resized in chunks to avoid per-request
  // reallocation. Trimmed to `ops` length before sorting for percentiles.
  let latencies = new Float64Array(65536);
  function recordLatency(ms: number): void {
    if (ops >= latencies.length) {
      const grown = new Float64Array(latencies.length * 2);
      grown.set(latencies);
      latencies = grown;
    }
    latencies[ops] = ms;
  }

  const start = performance.now();
  const stopAt = start + options.durationMs;
  await Promise.all(
    Array.from({ length: options.concurrency }, async () => {
      while (performance.now() < stopAt) {
        const reqStart = performance.now();
        await drain(await fetch(options.url, init));
        recordLatency(performance.now() - reqStart);
        ops += 1;
      }
    }),
  );
  const wallMs = performance.now() - start;
  const samples = latencies.subarray(0, ops).slice().sort();
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]!;
  return {
    ops,
    wallMs,
    opsPerSecond: (ops / wallMs) * 1000,
    errors,
    averageLatencyMs: samples.length ? sum / samples.length : 0,
    p50Ms: percentileOf(samples, 50),
    p95Ms: percentileOf(samples, 95),
    p99Ms: percentileOf(samples, 99),
  };
}
