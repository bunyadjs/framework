/** Node mirror of the core sitemap suites (same output under Bun and Node). */
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  fileSink,
  generateSitemaps,
  memorySink,
  resolveLoc,
  Sitemap,
  SitemapWriter,
  toW3cDate,
  Url,
} from "./index.ts";
import { robotsFor } from "./robots.ts";

const visible = (names: Iterable<string>) =>
  [...names].filter((n) => !n.startsWith("."));

const base = "https://example.com";

describe("sitemap core (node)", () => {
  it("escaping, dates, loc validation", () => {
    assert.equal(
      Url.create("https://e.com/a?x=1&y=<2>").toXml(),
      "<url><loc>https://e.com/a?x=1&amp;y=%3C2%3E</loc></url>",
    );
    assert.equal(
      toW3cDate("2026-10-14T08:00:00+05:00"),
      "2026-10-14T03:00:00+00:00",
    );
    assert.throws(() => resolveLoc("javascript:alert(1)"));
  });

  it("render golden + D3 optional tags", () => {
    const xml = Sitemap.create({ baseUrl: base, namespaces: [] })
      .add(Url.create("/a").setPriority(0.85))
      .add("/b")
      .render();
    assert.equal(
      xml,
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "<url><loc>https://example.com/a</loc><priority>0.9</priority></url>\n" +
        "<url><loc>https://example.com/b</loc></url>\n</urlset>\n",
    );
  });

  it("50,001 URLs → 2 gzip parts + plain index (file sink)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-node-"));
    try {
      const writer = new SitemapWriter({
        sink: fileSink(dir),
        baseUrl: base,
        gzip: true,
      });
      for (let i = 0; i < 50_001; i++) await writer.write(`${base}/p/${i}`);
      const result = await writer.close();
      assert.deepEqual(
        result.files.map((f) => [f.path, f.urls]),
        [
          ["sitemap-1.xml.gz", 50_000],
          ["sitemap-2.xml.gz", 1],
        ],
      );
      assert.deepEqual(visible(await readdir(dir)).sort(), [
        "sitemap-1.xml.gz",
        "sitemap-2.xml.gz",
        "sitemap.xml",
      ]);
      const part2 = gunzipSync(
        await readFile(join(dir, "sitemap-2.xml.gz")),
      ).toString("utf8");
      assert.match(part2, /<loc>https:\/\/example\.com\/p\/50000<\/loc>/);
      assert.match(
        await readFile(join(dir, "sitemap.xml"), "utf8"),
        /<sitemapindex/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("multi-domain + robots", async () => {
    const config = {
      domains: {
        "a.com": {
          baseUrl: "https://a.com",
          build: (s: Sitemap) => void s.add("/x"),
        },
        "b.com": {
          baseUrl: "https://b.com",
          build: (s: Sitemap) => void s.add("/y"),
        },
      },
    };
    const sinks = [memorySink(), memorySink()];
    let i = 0;
    await generateSitemaps(config, {
      sinkFor: () => sinks[i++] ?? memorySink(),
    });
    assert.match(sinks[1]?.text("sitemap.xml") ?? "", /https:\/\/b\.com\/y/);
    assert.equal(
      robotsFor(config),
      "User-agent: *\nAllow: /\n\nSitemap: https://a.com/sitemap.xml\nSitemap: https://b.com/sitemap.xml\n",
    );
  });
});
