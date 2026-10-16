/**
 * CI variant of the 1M-URL memory gate (bench/memory-1m.ts): 100k URLs, file sink.
 * Gates retained heap (heapUsed after Bun.gc(true)) ≤ 50 MB; RSS only gets a loose
 * 100 MB bound because CI runners showed ~52 MB of allocator/runtime RSS growth.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSink } from "./sinks.ts";
import { Url } from "./url.ts";
import { SitemapWriter } from "./writer.ts";

const mb = (bytes: number) => bytes / 1024 / 1024;

for (const gzip of [false, true]) {
  test(`100k URLs (gzip ${gzip}): 2 parts + index, retained heap growth ≤ 50 MB`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-mem-"));
    try {
      Bun.gc(true);
      const baseline = process.memoryUsage();
      let heapPeak = baseline.heapUsed;
      let rssPeak = baseline.rss;
      const sample = () => {
        rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
        // Gate on retained heap: collect first so garbage awaiting GC
        // (and allocator/runtime RSS noise on CI) doesn't count.
        Bun.gc(true);
        heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      };
      const writer = new SitemapWriter({
        sink: fileSink(dir),
        baseUrl: "https://example.com",
        gzip,
      });
      for (let i = 0; i < 100_000; i++) {
        await writer.write(
          Url.create(`https://example.com/posts/${i}`).setLastModificationDate(
            0,
          ),
        );
        if (i % 10_000 === 0) sample();
      }
      const result = await writer.close();
      sample();
      expect(result.files.map((f) => f.urls)).toEqual([50_000, 50_000]);
      expect(result.index).toBe("sitemap.xml");
      expect(mb(heapPeak - baseline.heapUsed)).toBeLessThan(50);
      // RSS includes allocator and runtime growth outside our control; a loose
      // bound still catches a buffer-everything regression (~100k URLs ≈ 10+ MB XML ×2).
      expect(mb(rssPeak - baseline.rss)).toBeLessThan(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
}
