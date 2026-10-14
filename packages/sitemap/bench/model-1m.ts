/**
 * T2.9: 1M SQLite rows → fromModel → split sitemap on local disk.
 *   bun bench/model-1m.ts [--rows=1000000]       (writeToDisk on LocalFilesystem)
 *   node --experimental-transform-types --expose-gc --max-semi-space-size=2 bench/model-1m.ts
 *     (writeToFile: @bunyad/filesystem's LocalFilesystem is Bun-only)
 * Asserts parts = ceil(n / 50,000) + index and retained heap growth ≤ 50 MB
 * (RSS also gated on Bun, reported on Node). Seeding time is excluded.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "@bunyad/orm";
import { MAX_URLS_PER_SITEMAP, Sitemap, Url } from "../src/index.ts";
import { writeToDisk } from "../src/disk.ts";
import { fromModel } from "../src/orm.ts";

const arg = process.argv.find((a) => a.startsWith("--rows="));
const N = arg ? Number(arg.slice(7)) : 1_000_000;
const BUDGET_MB = 50;
const SAMPLE_EVERY = 50_000;
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
const runtime = isBun
  ? `bun ${process.versions.bun}`
  : `node ${process.versions.node}`;
const mb = (b: number) => b / 1024 / 1024;

function gc(): void {
  const g = globalThis as {
    Bun?: { gc(force: boolean): void };
    gc?: () => void;
  };
  if (g.Bun) g.Bun.gc(true);
  else g.gc?.();
}

class BenchPost extends Model {
  static table = "bench_posts";
  declare id: number;
  declare slug: string;
}

const dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-model-"));
let failed = false;
try {
  const c = connectSqlite({ path: join(dir, "bench.sqlite") });
  Model.setConnection(c);
  await schemaFor(c).create("bench_posts", (b) => {
    b.id();
    b.string("slug");
  });
  const seedStart = performance.now();
  const BATCH = 5000;
  for (let i = 0; i < N; i += BATCH) {
    const n = Math.min(BATCH, N - i);
    const slugs = Array.from({ length: n }, (_, j) => `post-${i + j + 1}`);
    await c.run(
      `INSERT INTO bench_posts (slug) VALUES ${slugs.map(() => "(?)").join(",")}`,
      slugs,
    );
  }
  const seedSeconds = (performance.now() - seedStart) / 1000;

  const out = join(dir, "public");
  const lastmod = new Date(Date.UTC(2026, 9, 14));
  gc();
  const baseline = process.memoryUsage();
  let rssPeak = baseline.rss;
  let heapPeak = baseline.heapUsed;
  let rows = 0;
  let paused = 0;
  const sitemap = Sitemap.create({ baseUrl: "https://example.com" }).add(
    fromModel(BenchPost, {
      chunk: 5000,
      map: (p) => {
        if (++rows % SAMPLE_EVERY === 0) {
          rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
          const g0 = performance.now();
          gc();
          heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
          paused += performance.now() - g0;
        }
        return Url.create(`/posts/${p.slug}`).setLastModificationDate(lastmod);
      },
    }),
  );
  const start = performance.now();
  let result;
  if (isBun) {
    const { LocalFilesystem } = await import("@bunyad/filesystem");
    result = await writeToDisk(
      sitemap,
      new LocalFilesystem({ root: out }),
      "sitemap.xml",
    );
  } else {
    result = await sitemap.writeToFile(join(out, "sitemap.xml"));
  }
  const ms = performance.now() - start - paused;
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  const expected = Math.ceil(N / MAX_URLS_PER_SITEMAP);
  if (result.urls !== N)
    throw new Error(`expected ${N} urls, got ${result.urls}`);
  if (result.files.length !== expected)
    throw new Error(`expected ${expected} parts, got ${result.files.length}`);
  const summary = {
    runtime,
    rows: N,
    target: isBun ? "writeToDisk(LocalFilesystem)" : "writeToFile",
    parts: result.files.length,
    seedSeconds: +seedSeconds.toFixed(2),
    seconds: +(ms / 1000).toFixed(2),
    nsPerRow: Math.round((ms * 1e6) / N),
    rssGrowthMb: +mb(rssPeak - baseline.rss).toFixed(1),
    heapGrowthMb: +mb(heapPeak - baseline.heapUsed).toFixed(1),
  };
  console.log(JSON.stringify(summary));
  if (
    summary.heapGrowthMb > BUDGET_MB ||
    (isBun && summary.rssGrowthMb > BUDGET_MB)
  ) {
    console.error(`memory budget exceeded (${BUDGET_MB} MB)`);
    failed = true;
  }
  await c.close?.();
} finally {
  await rm(dir, { recursive: true, force: true });
}
if (failed) process.exit(1);
