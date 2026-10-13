/**
 * 1M-URL memory gate (TESTS.md, T1.8). Runs under Bun and Node:
 *   bun bench/memory-1m.ts [--urls=1000000]
 *   node --experimental-transform-types --expose-gc bench/memory-1m.ts
 * Asserts parts = ceil(n / 50,000) (+ index), each part ≤ 50,000 URLs and
 * ≤ 52,428,800 bytes, and peak memory growth ≤ 50 MB (Bun: RSS; Node: live
 * heap, RSS reported), for gzip off and on.
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
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      await writer.write(
        Url.create(`https://example.com/posts/${i}`).setLastModificationDate(
          lastmod,
        ),
      );
      if (i % 10_000 === 0) {
        const m = process.memoryUsage();
        peak = Math.max(peak, m.rss);
        heapPeak = Math.max(heapPeak, m.heapUsed);
      }
    }
    const result = await writer.close();
    const ms = performance.now() - start;
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
    console.log(JSON.stringify(line));
    // Bun: gate on RSS. Node: V8 lazily grows its heap with short-lived garbage
    // (live heap stays flat), so RSS there reflects GC policy, not retention:
    // gate on live heap and report RSS. `--max-semi-space-size=2` keeps Node
    // RSS growth under ~15 MB too.
    const gated = runtime.startsWith("bun") ? growth : heapGrowth;
    if (gated > BUDGET_MB) {
      throw new Error(`memory growth ${gated.toFixed(1)} MB > ${BUDGET_MB} MB`);
    }
    return line;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await run(false);
await run(true);
