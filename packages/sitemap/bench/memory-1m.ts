/**
 * 1M-URL memory gate (TESTS.md, T1.8). Runs under Bun and Node:
 *   bun bench/memory-1m.ts [--urls=1000000]
 *   node --experimental-transform-types --expose-gc bench/memory-1m.ts
 * Asserts parts = ceil(n / 50,000) (+ index), each part ≤ 50,000 URLs and
 * ≤ 52,428,800 bytes, and median (of --runs=3) memory growth ≤ 50 MB: retained
 * heap sampled after gc on both runtimes, RSS also gated on Bun (reported on
 * Node), for gzip off and on. Not part of CI (the 100k test is).
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileSink,
  MAX_SITEMAP_BYTES,
  MAX_URLS_PER_SITEMAP,
  SitemapWriter,
  Url,
} from "../src/index.ts";

const arg = process.argv.find((a) => a.startsWith("--urls="));
const N = arg ? Number(arg.slice(7)) : 1_000_000;
const BUDGET_MB = 50;
const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? Number(runsArg.slice(7)) : 3;
const SAMPLE_EVERY = 50_000;
const runtime =
  typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
    ? `bun ${process.versions.bun}`
    : `node ${process.versions.node}`;

function gc(): void {
  const g = globalThis as {
    Bun?: { gc(force: boolean): void };
    gc?: () => void;
  };
  if (g.Bun) g.Bun.gc(true);
  else g.gc?.();
}

const mb = (bytes: number) => bytes / 1024 / 1024;

async function run(gzip: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-1m-"));
  try {
    gc();
    const baseline = process.memoryUsage().rss;
    const heapBaseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    let heapPeak = heapBaseline;
    const lastmod = new Date(Date.UTC(2026, 9, 14));
    const writer = new SitemapWriter({
      sink: fileSink(dir),
      baseUrl: "https://example.com",
      gzip,
    });
    let paused = 0;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      await writer.write(
        Url.create(`https://example.com/posts/${i}`).setLastModificationDate(
          lastmod,
        ),
      );
      if (i % SAMPLE_EVERY === 0) {
        const raw = process.memoryUsage().rss;
        peak = Math.max(peak, raw);
        const g0 = performance.now();
        gc(); // F2: retained heap, not garbage awaiting collection
        heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
        paused += performance.now() - g0;
      }
    }
    const result = await writer.close();
    const ms = performance.now() - start - paused;
    peak = Math.max(peak, process.memoryUsage().rss);
    const expectedParts = Math.max(1, Math.ceil(N / MAX_URLS_PER_SITEMAP));
    let disk = 0;
    for (const f of result.files) {
      if (f.urls > MAX_URLS_PER_SITEMAP || f.bytes > MAX_SITEMAP_BYTES)
        throw new Error(`part over limit: ${JSON.stringify(f)}`);
      disk += (await stat(join(dir, f.path))).size;
    }
    if (result.files.length !== expectedParts)
      throw new Error(
        `expected ${expectedParts} parts, got ${result.files.length}`,
      );
    if (expectedParts > 1 && result.index !== "sitemap.xml")
      throw new Error("missing index");
    const growth = mb(peak - baseline);
    const heapGrowth = mb(heapPeak - heapBaseline);
    const line = {
      runtime,
      urls: N,
      gzip,
      parts: result.files.length,
      seconds: +(ms / 1000).toFixed(2),
      nsPerUrl: Math.round((ms * 1e6) / N),
      rssGrowthMb: +growth.toFixed(1),
      heapGrowthMb: +heapGrowth.toFixed(1),
      diskMb: +mb(disk).toFixed(1),
    };
    return line;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)] ?? 0;
};

let failed = false;
for (const gzip of [false, true]) {
  const lines = [];
  for (let r = 0; r < RUNS; r++) lines.push(await run(gzip));
  const summary = {
    runtime,
    urls: N,
    gzip,
    runs: RUNS,
    parts: lines[0]?.parts,
    seconds: median(lines.map((l) => l.seconds)),
    nsPerUrl: median(lines.map((l) => l.nsPerUrl)),
    rssGrowthMb: median(lines.map((l) => l.rssGrowthMb)),
    heapGrowthMb: median(lines.map((l) => l.heapGrowthMb)),
    diskMb: lines[0]?.diskMb,
  };
  console.log(JSON.stringify(summary));
  // Gate: retained heap (sampled after gc) on both runtimes; RSS gated on Bun,
  // reported on Node (V8 heap sizing; run with --max-semi-space-size=2).
  const isBun = runtime.startsWith("bun");
  if (
    summary.heapGrowthMb > BUDGET_MB ||
    (isBun && summary.rssGrowthMb > BUDGET_MB)
  ) {
    console.error(`memory budget exceeded (${BUDGET_MB} MB)`);
    failed = true;
  }
}
if (failed) process.exit(1);
