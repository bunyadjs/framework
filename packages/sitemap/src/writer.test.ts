import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzip } from "./gzip.ts";
import { fileSink, memorySink } from "./sinks.ts";
import { Url } from "./url.ts";
import {
  MAX_SITEMAP_BYTES,
  SitemapTagTooLargeError,
  SitemapWriter,
} from "./writer.ts";
import { InvalidSitemapUrlError } from "./escape.ts";

const visible = (names: Iterable<string>) =>
  [...names].filter((n) => !n.startsWith("."));

const base = "https://example.com";
const dec = new TextDecoder();
const count = (xml: string, tag: string) => xml.split(`<${tag}>`).length - 1;

async function writeN(writer: SitemapWriter, n: number, prefix = "/p/") {
  for (let i = 0; i < n; i++) await writer.write(`${base}${prefix}${i}`);
  return writer.close();
}

describe("SitemapWriter limits", () => {
  test("empty sitemap is a valid empty urlset", async () => {
    const sink = memorySink();
    const result = await new SitemapWriter({ sink, baseUrl: base }).close();
    expect(result.files).toEqual([
      { path: "sitemap.xml", urls: 0, bytes: expect.any(Number) },
    ]);
    expect(sink.text("sitemap.xml")).toContain("<urlset");
    expect(sink.text("sitemap.xml")).toEndWith("</urlset>\n");
  });

  test("50,000 → one file; 50,001 → two parts + index", async () => {
    const one = memorySink();
    const r1 = await writeN(
      new SitemapWriter({ sink: one, baseUrl: base }),
      50_000,
    );
    expect(r1.index).toBeUndefined();
    expect(visible(one.files.keys())).toEqual(["sitemap.xml"]);
    expect(count(one.text("sitemap.xml"), "url")).toBe(50_000);

    const two = memorySink();
    const r2 = await writeN(
      new SitemapWriter({ sink: two, baseUrl: base }),
      50_001,
    );
    expect(r2.index).toBe("sitemap.xml");
    expect(visible(two.files.keys()).sort()).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap.xml",
    ]);
    expect(r2.files.map((f) => f.urls)).toEqual([50_000, 1]);
    const index = two.text("sitemap.xml");
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("<loc>https://example.com/sitemap-1.xml</loc>");
    expect(index).toContain("<loc>https://example.com/sitemap-2.xml</loc>");
    expect(count(two.text("sitemap-2.xml"), "url")).toBe(1);
  });

  test("custom maxUrls(10)", async () => {
    const sink = memorySink();
    const r = await writeN(
      new SitemapWriter({ sink, baseUrl: base, maxUrls: 10 }),
      25,
    );
    expect(r.files.map((f) => f.urls)).toEqual([10, 10, 5]);
  });

  test("byte rollover: every part ≤ maxBytes, exact byte accounting", async () => {
    const sink = memorySink();
    const r = await writeN(
      new SitemapWriter({ sink, baseUrl: base, maxBytes: 4096 }),
      300,
    );
    expect(r.files.length).toBeGreaterThan(2);
    for (const f of r.files) {
      const data = sink.files.get(f.path);
      expect(data?.byteLength).toBe(f.bytes);
      expect(f.bytes).toBeLessThanOrEqual(4096);
    }
    expect(r.files.reduce((n, f) => n + f.urls, 0)).toBe(300);
  });

  test("byte limit counts UTF-8 bytes, not chars", async () => {
    const sink = memorySink();
    const long = "ü".repeat(500);
    const writer = new SitemapWriter({ sink, baseUrl: base, maxBytes: 8192 });
    for (let i = 0; i < 20; i++)
      await writer.write(
        Url.create(`${base}/${i}`).addNews("N", "de", long, 0),
      );
    const r = await writer.close();
    for (const f of r.files)
      expect(sink.files.get(f.path)?.byteLength).toBeLessThanOrEqual(8192);
  });

  test("single oversize tag throws", async () => {
    const writer = new SitemapWriter({
      sink: memorySink(),
      baseUrl: base,
      maxBytes: 400,
    });
    await expect(writer.write(`${base}/${"a".repeat(1000)}`)).rejects.toThrow(
      SitemapTagTooLargeError,
    );
  });

  test("limits cannot exceed the protocol", () => {
    expect(
      () => new SitemapWriter({ sink: memorySink(), maxUrls: 50_001 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new SitemapWriter({
          sink: memorySink(),
          maxBytes: MAX_SITEMAP_BYTES + 1,
        }),
    ).toThrow(RangeError);
  });
});

describe("gzip (D2)", () => {
  test("default writes plain .xml", async () => {
    const sink = memorySink();
    await writeN(new SitemapWriter({ sink, baseUrl: base, maxUrls: 2 }), 3);
    expect(visible(sink.files.keys()).sort()).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap.xml",
    ]);
  });

  test("gzip:true → parts .xml.gz (gunzip identical), root index plain, index points to .gz", async () => {
    const plain = memorySink();
    await writeN(
      new SitemapWriter({ sink: plain, baseUrl: base, maxUrls: 2 }),
      5,
    );
    const sink = memorySink();
    const r = await writeN(
      new SitemapWriter({ sink, baseUrl: base, maxUrls: 2, gzip: true }),
      5,
    );
    expect(r.files.map((f) => f.path)).toEqual([
      "sitemap-1.xml.gz",
      "sitemap-2.xml.gz",
      "sitemap-3.xml.gz",
    ]);
    for (const n of [1, 2, 3]) {
      const gz = sink.files.get(`sitemap-${n}.xml.gz`);
      if (!gz) throw new Error("missing part");
      expect(dec.decode(await gunzip(gz))).toBe(plain.text(`sitemap-${n}.xml`));
    }
    const index = sink.text("sitemap.xml");
    expect(index).toStartWith("<?xml");
    expect(index).toContain("<loc>https://example.com/sitemap-3.xml.gz</loc>");
  });

  test("gzip:true with a single file keeps the root plain", async () => {
    const sink = memorySink();
    await writeN(new SitemapWriter({ sink, baseUrl: base, gzip: true }), 3);
    expect(visible(sink.files.keys())).toEqual(["sitemap.xml"]);
    expect(sink.text("sitemap.xml")).toStartWith("<?xml");
  });
});

describe("header, namespaces, stylesheet, publicUrl, host", () => {
  test("default declares all four extension namespaces; configurable", async () => {
    const sink = memorySink();
    await new SitemapWriter({ sink, baseUrl: base }).close();
    for (const ns of ["xhtml", "image", "video", "news"])
      expect(sink.text("sitemap.xml")).toContain(`xmlns:${ns}=`);
    const only = memorySink();
    await new SitemapWriter({ sink: only, namespaces: [] }).close();
    expect(only.text("sitemap.xml")).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
  });

  test("stylesheet is escaped in both urlset and index", async () => {
    const sink = memorySink();
    await writeN(
      new SitemapWriter({
        sink,
        baseUrl: base,
        maxUrls: 1,
        stylesheet: '/s.xsl?a=1&b="2"',
      }),
      2,
    );
    const pi =
      '<?xml-stylesheet type="text/xsl" href="/s.xsl?a=1&amp;b=&quot;2&quot;"?>';
    expect(sink.text("sitemap.xml")).toContain(pi);
    expect(sink.text("sitemap-1.xml")).toContain(pi);
  });

  test("publicUrl prefixes index locs; custom filename names parts", async () => {
    const sink = memorySink();
    await writeN(
      new SitemapWriter({
        sink,
        baseUrl: base,
        publicUrl: `${base}/sitemaps/a.com`,
        filename: "map.xml",
        maxUrls: 1,
      }),
      2,
    );
    expect(sink.text("map.xml")).toContain(
      "<loc>https://example.com/sitemaps/a.com/map-1.xml</loc>",
    );
  });

  test("split without baseUrl/publicUrl fails clearly", async () => {
    const writer = new SitemapWriter({ sink: memorySink(), maxUrls: 1 });
    await writer.write(`${base}/a`);
    await writer.write(`${base}/b`);
    await expect(writer.close()).rejects.toThrow("baseUrl");
  });

  test("cross-host warns (counted) or throws in strict", async () => {
    const warnings: string[] = [];
    const sink = memorySink();
    const w = new SitemapWriter({
      sink,
      baseUrl: base,
      host: "example.com",
      onWarning: (m) => warnings.push(m),
    });
    await w.write("/ok");
    await w.write("https://other.com/x");
    const r = await w.close();
    expect(r.warnings).toBe(1);
    expect(warnings[0]).toContain("other.com");
    const strict = new SitemapWriter({
      sink: memorySink(),
      baseUrl: base,
      host: "example.com",
      strict: true,
    });
    await expect(strict.write("https://other.com/x")).rejects.toThrow(
      InvalidSitemapUrlError,
    );
  });
});

describe("atomic publish (file sink)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("stale parts from a bigger previous run are removed; no temp files left", async () => {
    await writeN(
      new SitemapWriter({ sink: fileSink(dir), baseUrl: base, maxUrls: 2 }),
      7,
    );
    expect(visible(await readdir(dir)).sort()).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap-3.xml",
      "sitemap-4.xml",
      "sitemap.xml",
    ]);
    await writeN(
      new SitemapWriter({ sink: fileSink(dir), baseUrl: base, maxUrls: 2 }),
      3,
    );
    expect(visible(await readdir(dir)).sort()).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap.xml",
    ]);
    await writeN(new SitemapWriter({ sink: fileSink(dir), baseUrl: base }), 3);
    expect(visible(await readdir(dir))).toEqual(["sitemap.xml"]);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("switching to gzip removes old plain parts", async () => {
    await writeN(
      new SitemapWriter({ sink: fileSink(dir), baseUrl: base, maxUrls: 2 }),
      3,
    );
    await writeN(
      new SitemapWriter({
        sink: fileSink(dir),
        baseUrl: base,
        maxUrls: 2,
        gzip: true,
      }),
      3,
    );
    expect(visible(await readdir(dir)).sort()).toEqual([
      "sitemap-1.xml.gz",
      "sitemap-2.xml.gz",
      "sitemap.xml",
    ]);
  });

  test("failure mid-write leaves the previous set intact", async () => {
    await writeFile(join(dir, "sitemap.xml"), "OLD");
    const writer = new SitemapWriter({
      sink: fileSink(dir),
      baseUrl: base,
      maxUrls: 2,
    });
    await writer.write("/a");
    await writer.write("/b");
    await writer.write("/c");
    await expect(writer.write("javascript:x")).rejects.toThrow();
    await writer.abort();
    expect(await readFile(join(dir, "sitemap.xml"), "utf8")).toBe("OLD");
    expect(await readdir(dir)).toEqual(["sitemap.xml"]);
  });

  test("other files in the directory are untouched", async () => {
    await writeFile(join(dir, "robots.txt"), "x");
    await writeFile(join(dir, "sitemap-news.xml"), "x");
    await writeN(new SitemapWriter({ sink: fileSink(dir), baseUrl: base }), 1);
    expect(visible(await readdir(dir)).sort()).toEqual([
      "robots.txt",
      "sitemap-news.xml",
      "sitemap.xml",
    ]);
  });
});

describe("F5 manifest-based stale cleanup", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("foreign sitemap-N.xml files (not in our manifest) are never deleted", async () => {
    await writeFile(join(dir, "sitemap-9.xml"), "foreign");
    await writeN(
      new SitemapWriter({ sink: fileSink(dir), baseUrl: base, maxUrls: 2 }),
      3,
    );
    await writeN(new SitemapWriter({ sink: fileSink(dir), baseUrl: base }), 1);
    expect(visible(await readdir(dir)).sort()).toEqual([
      "sitemap-9.xml",
      "sitemap.xml",
    ]);
    expect(await readFile(join(dir, "sitemap-9.xml"), "utf8")).toBe("foreign");
  });

  test("a corrupt manifest deletes nothing", async () => {
    await writeN(
      new SitemapWriter({ sink: fileSink(dir), baseUrl: base, maxUrls: 2 }),
      3,
    );
    await writeFile(join(dir, ".sitemap.manifest.json"), "{nope");
    await writeN(new SitemapWriter({ sink: fileSink(dir), baseUrl: base }), 1);
    expect(visible(await readdir(dir)).sort()).toEqual([
      "sitemap-1.xml",
      "sitemap-2.xml",
      "sitemap.xml",
    ]);
  });
});
