import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findDomain,
  generateSitemaps,
  resolveDomains,
  type SitemapConfig,
} from "./domains.ts";
import { fileSink, memorySink, type MemorySink } from "./sinks.ts";
import { InvalidSitemapUrlError } from "./escape.ts";

const two: SitemapConfig = {
  domains: {
    "example.com": {
      baseUrl: "https://example.com/",
      build: (s) => void s.add(["/", "/about"]),
    },
    "Shop.Example.com": {
      baseUrl: "https://shop.example.com",
      build: (s) => void s.add("/cart"),
    },
  },
};

describe("resolveDomains (D7)", () => {
  test("single-domain sugar → one entry at the disk root", () => {
    const [d] = resolveDomains({ baseUrl: "https://example.com/" });
    expect(d).toMatchObject({
      host: "example.com",
      baseUrl: "https://example.com",
      directory: "",
      path: "sitemap.xml",
      sitemapUrl: "https://example.com/sitemap.xml",
      publicUrl: "https://example.com/",
    });
  });

  test("multi-domain → sitemaps/<host>/, served per host by the auto-route", () => {
    const ds = resolveDomains(two);
    expect(ds.map((d) => d.path)).toEqual([
      "sitemaps/example.com/sitemap.xml",
      "sitemaps/shop.example.com/sitemap.xml",
    ]);
    expect(ds[1]?.sitemapUrl).toBe("https://shop.example.com/sitemap.xml");
  });

  test("custom route path / disabled route change public URLs", () => {
    const custom = resolveDomains({
      ...two,
      route: { path: "/maps/site.xml" },
    });
    expect(custom[0]).toMatchObject({
      sitemapUrl: "https://example.com/maps/site.xml",
      publicUrl: "https://example.com/maps/",
    });
    const off = resolveDomains({ ...two, route: { enabled: false } });
    expect(off[0]).toMatchObject({
      sitemapUrl: "https://example.com/sitemaps/example.com/sitemap.xml",
      publicUrl: "https://example.com/sitemaps/example.com/",
    });
  });

  test("never reads APP_URL", () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://third.example";
    try {
      expect(JSON.stringify(resolveDomains(two))).not.toContain(
        "third.example",
      );
      expect(() => resolveDomains({})).toThrow("APP_URL is never used");
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });

  test("validation: host/baseUrl mismatch, bad path, both forms", () => {
    expect(() =>
      resolveDomains({ domains: { "a.com": { baseUrl: "https://b.com" } } }),
    ).toThrow("does not match");
    expect(() =>
      resolveDomains({ baseUrl: "https://a.com", path: "../x.xml" }),
    ).toThrow("plain");
    expect(() => resolveDomains({ baseUrl: "ftp://a.com" })).toThrow("http");
    expect(() => resolveDomains({ ...two, baseUrl: "https://a.com" })).toThrow(
      "either",
    );
  });

  test("findDomain by Host, case-insensitive; unknown → undefined", () => {
    expect(findDomain(two, "SHOP.example.com")?.host).toBe("shop.example.com");
    expect(findDomain(two, "nope.com")).toBeUndefined();
  });
});

describe("generateSitemaps", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("two hosts → two sets under sitemaps/<host>/ with their own base URL", async () => {
    const results = await generateSitemaps(two, {
      sinkFor: (d) => fileSink(join(dir, d.directory)),
    });
    expect(results.map((r) => r.result.urls)).toEqual([2, 1]);
    expect(await readdir(join(dir, "sitemaps"))).toEqual(
      expect.arrayContaining(["example.com", "shop.example.com"]),
    );
    const shop = await readFile(
      join(dir, "sitemaps/shop.example.com/sitemap.xml"),
      "utf8",
    );
    expect(shop).toContain("<loc>https://shop.example.com/cart</loc>");
    expect(shop).not.toContain("https://example.com/");
  });

  test("split parts of a domain are indexed under its public URL", async () => {
    const sinks = new Map<string, MemorySink>();
    await generateSitemaps(
      { ...two, maxTagsPerSitemap: 1, gzip: true },
      {
        sinkFor: (d) => {
          const s = memorySink();
          sinks.set(d.host, s);
          return s;
        },
      },
    );
    expect(sinks.get("example.com")?.text("sitemap.xml")).toContain(
      "<loc>https://example.com/sitemap-1.xml.gz</loc>",
    );
  });

  test("--domain filter, unknown domain, scope hook", async () => {
    const scopes: string[] = [];
    const results = await generateSitemaps(two, {
      domain: "shop.example.com",
      sinkFor: () => memorySink(),
      scope: async (baseUrl, fn) => {
        scopes.push(baseUrl);
        return fn();
      },
    });
    expect(results.map((r) => r.domain.host)).toEqual(["shop.example.com"]);
    expect(scopes).toEqual(["https://shop.example.com"]);
    await expect(
      generateSitemaps(two, { domain: "x.com", sinkFor: () => memorySink() }),
    ).rejects.toThrow("not configured");
  });

  test("cross-host URL in a domain's build warns, or throws when strict", async () => {
    const config: SitemapConfig = {
      domains: {
        "a.com": {
          baseUrl: "https://a.com",
          build: (s) => void s.add("https://b.com/x"),
        },
      },
    };
    const warnings: string[] = [];
    const [r] = await generateSitemaps(config, {
      sinkFor: () => memorySink(),
      onWarning: (m) => warnings.push(m),
    });
    expect(r?.result.warnings).toBe(1);
    expect(warnings).toHaveLength(1);
    await expect(
      generateSitemaps(
        { ...config, strict: true },
        { sinkFor: () => memorySink() },
      ),
    ).rejects.toThrow(InvalidSitemapUrlError);
  });
});
