import { describe, expect, test } from "bun:test";
import { SitemapTag } from "./sitemap-tag.ts";
import { Url } from "./url.ts";

const d = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

describe("Url (spatie Tags\\Url)", () => {
  test("create / setUrl / constants", () => {
    const url = Url.create("https://example.com/a").setUrl(
      "https://example.com/b",
    );
    expect(url.url).toBe("https://example.com/b");
    expect(Url.CHANGE_FREQUENCY_DAILY).toBe("daily");
    expect(Url.CHANGE_FREQUENCY_NEVER).toBe("never");
  });

  test("D3: no changefreq/priority unless set", () => {
    expect(Url.create("https://example.com/").toXml()).toBe(
      "<url><loc>https://example.com/</loc></url>",
    );
  });

  test("full tag in spatie element order", () => {
    const xml = Url.create("https://example.com/p?a=1&b=2")
      .addAlternate("https://example.com/ur/p", "ur")
      .addAlternate("https://example.com/p")
      .setLastModificationDate(d)
      .setChangeFrequency(Url.CHANGE_FREQUENCY_WEEKLY)
      .setPriority(0.85)
      .addImage("https://example.com/i.png")
      .toXml();
    expect(xml).toBe(
      "<url><loc>https://example.com/p?a=1&amp;b=2</loc>" +
        "<lastmod>2026-01-02T03:04:05+00:00</lastmod>" +
        "<changefreq>weekly</changefreq><priority>0.9</priority>" +
        '<xhtml:link rel="alternate" hreflang="ur" href="https://example.com/ur/p"/>' +
        '<xhtml:link rel="alternate" href="https://example.com/p"/>' +
        "<image:image><image:loc>https://example.com/i.png</image:loc></image:image></url>",
    );
  });

  test("priority clamps like spatie; 0 is emitted; invalid changefreq throws", () => {
    expect(Url.create("https://e.com/").setPriority(7).priority).toBe(1);
    expect(Url.create("https://e.com/").setPriority(-1).priority).toBe(0);
    expect(Url.create("https://e.com/").setPriority(0).toXml()).toContain(
      "<priority>0.0</priority>",
    );
    expect(() =>
      Url.create("https://e.com/").setChangeFrequency("sometimes" as never),
    ).toThrow(RangeError);
    expect(() => Url.create("https://e.com/").setPriority(Number.NaN)).toThrow(
      RangeError,
    );
  });

  test("config defaults emit; per-URL overrides default", () => {
    const defaults = { changefreq: "daily" as const, priority: 0.5 };
    expect(Url.create("https://e.com/").toXml({ defaults })).toBe(
      "<url><loc>https://e.com/</loc><changefreq>daily</changefreq><priority>0.5</priority></url>",
    );
    expect(
      Url.create("https://e.com/")
        .setChangeFrequency("never")
        .setPriority(1)
        .toXml({ defaults }),
    ).toContain("<changefreq>never</changefreq><priority>1.0</priority>");
  });

  test("relative loc resolves via baseUrl; escaping in every text node", () => {
    expect(Url.create("/a<b").toXml({ baseUrl: "https://e.com" })).toBe(
      "<url><loc>https://e.com/a%3Cb</loc></url>",
    );
    const xml = Url.create("https://e.com/v")
      .addVideo(
        "https://e.com/t.jpg",
        "T & <b>",
        'D "q"',
        "https://e.com/v.mp4",
        null,
        {
          duration: 60,
          family_friendly: true,
        },
        { platform: "web" },
        { country: "US" },
        ["a&b"],
      )
      .toXml();
    expect(xml).toContain("<video:title>T &amp; &lt;b&gt;</video:title>");
    expect(xml).toContain(
      "<video:description>D &quot;q&quot;</video:description>",
    );
    expect(xml).toContain("<video:duration>60</video:duration>");
    expect(xml).toContain("<video:family_friendly>yes</video:family_friendly>");
    expect(xml).toContain(
      '<video:platform relationship="allow">web</video:platform>',
    );
    expect(xml).toContain(
      '<video:country relationship="deny">US</video:country>',
    );
    expect(xml).toContain("<video:tag>a&amp;b</video:tag>");
    expect(xml).not.toContain("player_loc");
  });

  test("video needs content or player loc; images capped at 1,000", () => {
    expect(() =>
      Url.create("https://e.com/").addVideo("https://e.com/t", "t", "d"),
    ).toThrow(TypeError);
    const url = Url.create("https://e.com/");
    for (let i = 0; i < 1000; i++) url.addImage(`https://e.com/${i}.png`);
    expect(() => url.addImage("https://e.com/x.png")).toThrow(RangeError);
  });

  test("F6: video/news option keys must be XML NCNames", () => {
    const u = Url.create("https://e.com/");
    for (const bad of ["a b", "x><evil", "1st", "", "a:b"]) {
      expect(() =>
        u.addVideo("https://e.com/t", "t", "d", "https://e.com/v", null, {
          [bad]: 1,
        }),
      ).toThrow(TypeError);
      expect(() =>
        u.addVideo(
          "https://e.com/t",
          "t",
          "d",
          "https://e.com/v",
          null,
          {},
          { [bad]: "x" },
        ),
      ).toThrow(TypeError);
      expect(() => u.addNews("n", "en", "t", 0, { [bad]: "x" })).toThrow(
        TypeError,
      );
    }
    expect(() =>
      u.addNews("n", "en", "t", 0, { stock_tickers: "X", "a.b-c": "y" }),
    ).not.toThrow();
  });

  test("news", () => {
    const xml = Url.create("https://e.com/n")
      .addNews("Daily", "en", "Title & co", d, { keywords: "a,b" })
      .toXml();
    expect(xml).toContain(
      "<news:news><news:publication><news:name>Daily</news:name><news:language>en</news:language></news:publication>" +
        "<news:publication_date>2026-01-02T03:04:05+00:00</news:publication_date>" +
        "<news:title>Title &amp; co</news:title><news:keywords>a,b</news:keywords></news:news>",
    );
  });

  test("path / segments / segment (1-based)", () => {
    const url = Url.create("https://e.com/blog/2026/post?x=1");
    expect(url.path()).toBe("/blog/2026/post");
    expect(url.segments()).toEqual(["blog", "2026", "post"]);
    expect(url.segments(2)).toBe("2026");
    expect(url.segment(1)).toBe("blog");
    expect(url.segment(9)).toBeNull();
  });

  test("toJSON", () => {
    expect(
      Url.create("https://e.com/").setLastModificationDate(d).toJSON()
        .lastModificationDate,
    ).toBe("2026-01-02T03:04:05+00:00");
  });
});

test("SitemapTag (spatie Tags\\Sitemap)", () => {
  expect(
    SitemapTag.create("/s-1.xml")
      .setLastModificationDate(d)
      .toXml("https://e.com"),
  ).toBe(
    "<sitemap><loc>https://e.com/s-1.xml</loc><lastmod>2026-01-02T03:04:05+00:00</lastmod></sitemap>",
  );
});
