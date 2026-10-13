import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memorySink } from "./sinks.ts";
import { Sitemap, type Sitemapable } from "./sitemap.ts";
import { SitemapIndex } from "./sitemap-index.ts";
import { SitemapTag } from "./sitemap-tag.ts";
import { Url } from "./url.ts";
import { SitemapLimitError } from "./writer.ts";

const visible = (names: Iterable<string>) =>
  [...names].filter((n) => !n.startsWith("."));

const base = "https://example.com";
const HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n';

class Post implements Sitemapable {
  constructor(readonly slug: string) {}
  toSitemapTag() {
    return Url.create(`/posts/${this.slug}`);
  }
}

describe("Sitemap façade (spatie Sitemap)", () => {
  test("golden render: strings, Url, Sitemapable, arrays; empty strings skipped", () => {
    const xml = Sitemap.create({ baseUrl: base })
      .add("/")
      .add("")
      .add(Url.create("/about").setLastModificationDate(Date.UTC(2026, 0, 1)))
      .add(new Post("hello"))
      .add([{ toSitemapTag: () => ["/a", Url.create("/b")] }])
      .render();
    expect(xml).toBe(
      HEAD +
        "<url><loc>https://example.com/</loc></url>\n" +
        "<url><loc>https://example.com/about</loc><lastmod>2026-01-01T00:00:00+00:00</lastmod></url>\n" +
        "<url><loc>https://example.com/posts/hello</loc></url>\n" +
        "<url><loc>https://example.com/a</loc></url>\n" +
        "<url><loc>https://example.com/b</loc></url>\n" +
        "</urlset>\n",
    );
  });

  test("getTags / getUrl / hasUrl / sort", () => {
    const sitemap = Sitemap.create()
      .add("https://e.com/b")
      .add("https://e.com/a");
    expect(sitemap.getTags().map((t) => t.url)).toEqual([
      "https://e.com/b",
      "https://e.com/a",
    ]);
    expect(sitemap.hasUrl("https://e.com/a")).toBe(true);
    expect(sitemap.getUrl("https://e.com/x")).toBeUndefined();
    expect(
      sitemap
        .sort()
        .getTags()
        .map((t) => t.url),
    ).toEqual(["https://e.com/a", "https://e.com/b"]);
  });

  test("setStylesheet + config defaults", () => {
    const xml = Sitemap.create({
      baseUrl: base,
      defaults: { changefreq: "daily", priority: null },
    })
      .setStylesheet("/sitemap.xsl")
      .add("/")
      .render();
    expect(xml).toContain(
      '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>',
    );
    expect(xml).toContain("<changefreq>daily</changefreq>");
    expect(xml).not.toContain("<priority>");
  });

  test("render refuses lazy sources and > maxTagsPerSitemap", () => {
    async function* lazy() {
      yield "/x";
    }
    expect(() =>
      Sitemap.create({ baseUrl: base }).add(lazy()).render(),
    ).toThrow(SitemapLimitError);
    const big = Sitemap.create({ baseUrl: base })
      .maxTagsPerSitemap(2)
      .add(["/a", "/b", "/c"]);
    expect(() => big.render()).toThrow(SitemapLimitError);
    expect(() => Sitemap.create().maxTagsPerSitemap(50_001)).toThrow(
      RangeError,
    );
  });

  test("lazy (async) iterables are pulled only while writing", async () => {
    let pulled = 0;
    async function* rows() {
      for (let i = 0; i < 5; i++) {
        pulled++;
        yield i % 2 ? `/r/${i}` : new Post(String(i));
      }
    }
    const sitemap = Sitemap.create({ baseUrl: base }).add(rows());
    expect(pulled).toBe(0);
    const sink = memorySink();
    const r = await sitemap.writeTo(sink);
    expect(pulled).toBe(5);
    expect(r.urls).toBe(5);
  });

  test("stream() yields one document identical to render()", async () => {
    const sitemap = Sitemap.create({ baseUrl: base }).add(["/a", "/b"]);
    const text = await new Response(
      new ReadableStream({
        async start(c) {
          for await (const chunk of sitemap.stream()) c.enqueue(chunk);
          c.close();
        },
      }),
    ).text();
    expect(text).toBe(sitemap.render());
  });

  test("stream() throws past limits", async () => {
    const sitemap = Sitemap.create({ baseUrl: base })
      .maxTagsPerSitemap(1)
      .add(["/a", "/b"]);
    const run = async () => {
      for await (const _ of sitemap.stream()) void _;
    };
    await expect(run()).rejects.toThrow(SitemapLimitError);
  });

  test("bad input types throw", () => {
    expect(() => Sitemap.create().add(42 as never)).toThrow(TypeError);
  });
});

describe("writeToFile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("splits with maxTagsPerSitemap and writes an index (gzip parts)", async () => {
    const r = await Sitemap.create({ baseUrl: base })
      .maxTagsPerSitemap(2)
      .add(["/a", "/b", "/c"])
      .writeToFile(join(dir, "public/sitemap.xml"), { gzip: true });
    expect(r.index).toBe("sitemap.xml");
    expect(visible(await readdir(join(dir, "public"))).sort()).toEqual([
      "sitemap-1.xml.gz",
      "sitemap-2.xml.gz",
      "sitemap.xml",
    ]);
    expect(await readFile(join(dir, "public/sitemap.xml"), "utf8")).toContain(
      "sitemap-2.xml.gz",
    );
  });
});

describe("SitemapIndex (spatie SitemapIndex)", () => {
  test("render, getSitemap, hasSitemap, stylesheet, writeTo", async () => {
    const index = SitemapIndex.create({ baseUrl: base })
      .add("/sitemap-posts.xml.gz")
      .add(SitemapTag.create("/sitemap-pages.xml").setLastModificationDate(0))
      .setStylesheet("/i.xsl");
    expect(index.hasSitemap("/sitemap-posts.xml.gz")).toBe(true);
    expect(index.getSitemap("/nope")).toBeUndefined();
    const xml = index.render();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<?xml-stylesheet type="text/xsl" href="/i.xsl"?>\n' +
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "<sitemap><loc>https://example.com/sitemap-posts.xml.gz</loc></sitemap>\n" +
        "<sitemap><loc>https://example.com/sitemap-pages.xml</loc><lastmod>1970-01-01T00:00:00+00:00</lastmod></sitemap>\n" +
        "</sitemapindex>\n",
    );
    const sink = memorySink();
    await index.writeTo(sink, "index.xml");
    expect(sink.text("index.xml")).toBe(xml);
  });
});
