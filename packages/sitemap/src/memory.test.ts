/** CI variant of the 1M-URL memory gate (bench/memory-1m.ts): 100k URLs, file sink. */
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSink } from "./sinks.ts";
import { Url } from "./url.ts";
import { SitemapWriter } from "./writer.ts";

for (const gzip of [false, true]) {
  test(`100k URLs (gzip ${gzip}): 2 parts + index, RSS growth ≤ 50 MB`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-mem-"));
    try {
      Bun.gc(true);
      const baseline = process.memoryUsage().rss;
      let peak = baseline;
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
        if (i % 10_000 === 0) peak = Math.max(peak, process.memoryUsage().rss);
      }
      const result = await writer.close();
      peak = Math.max(peak, process.memoryUsage().rss);
      expect(result.files.map((f) => f.urls)).toEqual([50_000, 50_000]);
      expect(result.index).toBe("sitemap.xml");
      expect((peak - baseline) / 1024 / 1024).toBeLessThan(50);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
}
