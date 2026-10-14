import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application, createFetchHandler } from "@bunyad/core";
import { connectSqlite, listen, schemaFor } from "@bunyad/database";
import {
  LocalFilesystem,
  MemoryFilesystem,
  Storage,
  StorageFake,
} from "@bunyad/filesystem";
import { Request as BunyadRequest } from "@bunyad/http";
import { Model } from "@bunyad/orm";
import {
  Route,
  Router,
  Url as UrlGenerator,
  setActiveRouter,
} from "@bunyad/router";
import { dryRun, generateToDisk, SitemapGenerateCommand } from "./command.ts";
import { diskSink, safeDiskPath, writeToDisk } from "./disk.ts";
import { gunzip } from "./gzip.ts";
import { serveSitemapFile, toResponse } from "./http.ts";
import { fromModel } from "./orm.ts";
import { SITEMAP_NOT_CONFIGURED, SitemapServiceProvider } from "./provider.ts";
import { fromRoutes, routerScope, sitemapRoutes } from "./router.ts";
import { Sitemap } from "./sitemap.ts";
import { setSitemapConfig } from "./state.ts";
import { Url } from "./url.ts";

const dec = new TextDecoder();
async function collect(it: AsyncIterable<Url>): Promise<string[]> {
  const out: string[] = [];
  for await (const u of it) out.push(u.url);
  return out;
}

class SmPost extends Model {
  static table = "sm_posts";
  static fillable = ["slug", "published"];
  declare id: number;
  declare slug: string;
  declare published: number;
  toSitemapTag() {
    return Url.create(`/posts/${this.slug}`);
  }
}

describe("fromModel (T2.1)", () => {
  const c = connectSqlite();
  beforeAll(async () => {
    Model.setConnection(c);
    await schemaFor(c).create("sm_posts", (b) => {
      b.id();
      b.string("slug");
      b.integer("published");
    });
    const rows = Array.from({ length: 2500 }, (_, i) => [
      `p${i + 1}`,
      i % 5 === 0 ? 0 : 1,
    ]);
    for (let i = 0; i < rows.length; i += 250) {
      const chunk = rows.slice(i, i + 250);
      await c.run(
        `INSERT INTO sm_posts (slug, published) VALUES ${chunk.map(() => "(?, ?)").join(",")}`,
        chunk.flat(),
      );
    }
  });
  afterAll(async () => {
    await schemaFor(c).dropIfExists("sm_posts");
  });

  test("toSitemapTag per row, keyset pages: ceil(n/chunk)+1 queries at most", async () => {
    let selects = 0;
    const off = listen((e) => {
      if (/^\s*SELECT/i.test(e.sql)) selects++;
    });
    const urls = await collect(fromModel(SmPost));
    off();
    expect(urls).toHaveLength(2500);
    expect(urls[0]).toBe("/posts/p1");
    expect(selects).toBe(3);
  });

  test("query filter, chunk, map null skip, array return", async () => {
    const urls = await collect(
      fromModel(SmPost, {
        query: (q) => q.where("published", 1),
        chunk: 999,
        map: (p) =>
          p.id > 10 ? null : [`/a/${p.id}`, Url.create(`/b/${p.id}`)],
      }),
    );
    expect(urls).toEqual(
      [2, 3, 4, 5, 7, 8, 9, 10].flatMap((id) => [`/a/${id}`, `/b/${id}`]),
    );
  });

  test("models without toSitemapTag need map", async () => {
    class Bare extends Model {
      static table = "sm_posts";
    }
    await expect(collect(fromModel(Bare))).rejects.toThrow("toSitemapTag");
  });

  test("feeds a Sitemap lazily", async () => {
    const sink = new MemoryFilesystem();
    const r = await writeToDisk(
      Sitemap.create({ baseUrl: "https://e.com" })
        .maxTagsPerSitemap(1000)
        .add(fromModel(SmPost)),
      sink,
      "sitemap.xml",
    );
    expect(r.urls).toBe(2500);
    expect(r.files).toHaveLength(3);
  });
});

describe("fromRoutes (T2.2)", () => {
  const router = new Router();
  beforeAll(() => {
    setActiveRouter(router);
    router.get("/", () => "home").name("home");
    router.get("/about", () => "about").name("about");
    router.post("/contact", () => "x").name("contact.send");
    router.get("/unnamed", () => "x");
    router.get("/posts/{post}", () => "x").name("posts.show");
    router
      .get("/admin", () => "x")
      .name("admin")
      .middleware("auth");
    router
      .get("/dash", () => "x")
      .name("dash")
      .middleware("auth:web");
    router.domain("shop.example.com").group(() => {
      router.get("/cart", () => "x").name("shop.cart");
    });
  });
  afterAll(() => setActiveRouter(Route));

  test("GET + named + no params + not auth; domain routes by host", () => {
    expect(sitemapRoutes({ router }).map((r) => r.name)).toEqual([
      "home",
      "about",
      "shop.cart",
    ]);
    expect(
      sitemapRoutes({ router, host: "example.com" }).map((r) => r.name),
    ).toEqual(["home", "about"]);
    expect(
      sitemapRoutes({ router, host: "shop.example.com" }).map((r) => r.name),
    ).toContain("shop.cart");
  });

  test("only / except globs and params generators", async () => {
    const urls = await UrlGenerator.withRoot("https://a.com", () =>
      collect(
        fromRoutes({
          router,
          only: ["posts.*", "home", "about"],
          except: ["about"],
          params: { "posts.show": () => [{ post: 1 }, { post: "two" }] },
        }),
      ),
    );
    expect(urls).toEqual([
      "https://a.com/",
      "https://a.com/posts/1",
      "https://a.com/posts/two",
    ]);
  });

  test("routerScope pins the base URL per domain, no APP_URL leakage", async () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://third.example";
    try {
      const [a, b] = await Promise.all([
        routerScope("https://a.com", () =>
          collect(fromRoutes({ router, only: ["home"] })),
        ),
        routerScope("https://b.com", () =>
          collect(fromRoutes({ router, only: ["home"] })),
        ),
      ]);
      expect(a).toEqual(["https://a.com/"]);
      expect(b).toEqual(["https://b.com/"]);
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
    }
  });
});

describe("disk publish (T2.3)", () => {
  test("writeToDisk on StorageFake/MemoryFilesystem, nested path, gzip parts", async () => {
    const disk = new StorageFake();
    const r = await writeToDisk(
      Sitemap.create({ baseUrl: "https://e.com" })
        .maxTagsPerSitemap(2)
        .add(["/a", "/b", "/c"]),
      disk,
      "maps/sitemap.xml",
      { gzip: true, publicUrl: "https://e.com/maps/" },
    );
    expect(r.index).toBe("sitemap.xml");
    expect((await disk.files("maps")).filter((f) => !f.includes("/."))).toEqual(
      ["maps/sitemap-1.xml.gz", "maps/sitemap-2.xml.gz", "maps/sitemap.xml"],
    );
    const index = dec.decode(await disk.get("maps/sitemap.xml"));
    expect(index).toContain("https://e.com/maps/sitemap-2.xml.gz");
    expect(
      dec.decode(await gunzip(await disk.get("maps/sitemap-2.xml.gz"))),
    ).toContain("https://e.com/c");
  });

  test("path traversal rejected", () => {
    for (const bad of [
      "../x.xml",
      "a/../../x.xml",
      "a\0.xml",
      "%2e%2e/x.xml",
      "a\\b.xml",
      "C:/x.xml",
      "a//b.xml",
    ]) {
      expect(() => safeDiskPath(bad)).toThrow();
    }
    expect(safeDiskPath("/maps/sitemap.xml")).toBe("maps/sitemap.xml");
    expect(() => diskSink(new MemoryFilesystem(), "../up")).toThrow();
  });

  test("local disk: streams and leaves no temp files", async () => {
    const root = await mkdtemp(join(tmpdir(), "bunyad-sitemap-disk-"));
    try {
      const disk = new LocalFilesystem({ root });
      await writeToDisk(
        Sitemap.create({ baseUrl: "https://e.com" }).add(["/a", "/b"]),
        disk,
      );
      expect(dec.decode(await disk.get("sitemap.xml"))).toContain(
        "<loc>https://e.com/b</loc>",
      );
      expect((await disk.files()).filter((f) => f.endsWith(".tmp"))).toEqual(
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("responses (T2.4)", () => {
  test("toResponse: headers, streamed body, gzip negotiation", async () => {
    const sitemap = Sitemap.create({ baseUrl: "https://e.com" }).add([
      "/a",
      "/b",
    ]);
    const plain = toResponse(sitemap);
    expect(plain.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(plain.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    expect(plain.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await plain.text()).toBe(sitemap.render());
    const gz = toResponse(
      sitemap,
      new Request("https://e.com/", {
        headers: { "accept-encoding": "br, gzip;q=0.5" },
      }),
      {
        maxAge: 60,
      },
    );
    expect(gz.headers.get("Content-Encoding")).toBe("gzip");
    expect(gz.headers.get("Cache-Control")).toStartWith("public, max-age=60");
    expect(
      dec.decode(await gunzip(new Uint8Array(await gz.arrayBuffer()))),
    ).toBe(sitemap.render());
    const refused = toResponse(
      sitemap,
      new Request("https://e.com/", {
        headers: { "accept-encoding": "gzip;q=0" },
      }),
    );
    expect(refused.headers.get("Content-Encoding")).toBeNull();
  });

  test("toResponse: first chunk before completion; oversize errors", async () => {
    let pulled = 0;
    async function* many() {
      for (let i = 0; i < 100_000; i++) {
        pulled++;
        yield `/p/${i}`;
      }
    }
    const res = toResponse(
      Sitemap.create({ baseUrl: "https://e.com" }).add(many()),
    );
    const reader = res.body?.getReader();
    const first = await reader?.read();
    expect(first?.done).toBe(false);
    expect(pulled).toBeLessThan(100_000);
    await reader?.cancel();
    const over = toResponse(
      Sitemap.create({ baseUrl: "https://e.com" })
        .maxTagsPerSitemap(1)
        .add(["/a", "/b"]),
    );
    await expect(over.text()).rejects.toThrow();
  });

  test("serveSitemapFile: 404, ETag/304, If-Modified-Since, gz parts, HEAD", async () => {
    const disk = new MemoryFilesystem();
    expect((await serveSitemapFile(disk, "sitemap.xml")).status).toBe(404);
    await disk.put("sitemap.xml", "<urlset/>");
    await disk.put("sitemap-1.xml.gz", new Uint8Array([0x1f, 0x8b]));
    const ok = await serveSitemapFile(disk, "sitemap.xml");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("<urlset/>");
    const etag = ok.headers.get("ETag") ?? "";
    const lm = ok.headers.get("Last-Modified") ?? "";
    expect(
      (
        await serveSitemapFile(
          disk,
          "sitemap.xml",
          new Request("https://e.com", { headers: { "if-none-match": etag } }),
        )
      ).status,
    ).toBe(304);
    expect(
      (
        await serveSitemapFile(
          disk,
          "sitemap.xml",
          new Request("https://e.com", {
            headers: { "if-modified-since": lm },
          }),
        )
      ).status,
    ).toBe(304);
    const part = await serveSitemapFile(
      disk,
      "sitemap-1.xml.gz",
      new Request("https://e.com", { headers: { "accept-encoding": "gzip" } }),
    );
    expect(part.headers.get("Content-Type")).toBe("application/gzip");
    expect(part.headers.get("Content-Encoding")).toBeNull();
    const head = await serveSitemapFile(disk, "sitemap.xml", {
      headers: new Headers(),
      method: "HEAD",
    });
    expect(head.headers.get("Content-Length")).toBe("9");
    expect((await serveSitemapFile(disk, "../sitemap.xml")).status).toBe(404);
    expect((await serveSitemapFile(disk, "secret.txt")).status).toBe(404);
  });
});

describe("provider auto-route (T2.5) + command (T2.6)", () => {
  test("warns when neither baseUrl nor domains is configured (I2)", async () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args[0]);
    try {
      const router = new Router();
      const app = new Application({ router, config: { app: { port: 0 } } });
      app.register(SitemapServiceProvider);
      await app.boot();
      expect(warnings).toEqual([SITEMAP_NOT_CONFIGURED]);
      expect(router.has("sitemap")).toBe(false);
    } finally {
      console.warn = original;
    }
  });

  const twoDomains = (disk: string) => ({
    disk,
    domains: {
      "a.com": {
        baseUrl: "https://a.com",
        build: (s: Sitemap) => void s.add(["/x", "/y", "/z"]),
      },
      "b.com": {
        baseUrl: "https://b.com",
        build: (s: Sitemap) => void s.add(fromRoutes({ only: ["home"] })),
      },
    },
    maxTagsPerSitemap: 2,
    gzip: true,
    robots: { enabled: true },
  });

  async function boot(sitemap: Record<string, unknown>) {
    const router = new Router();
    router.get("/", () => "home").name("home");
    const app = new Application({
      router,
      config: { app: { port: 0 }, sitemap },
    });
    app.register(SitemapServiceProvider);
    await app.boot();
    return { app, fetch: createFetchHandler(app) };
  }

  let fake: StorageFake;
  beforeAll(() => {
    fake = Storage.fake("sm-public");
  });
  afterEach(() => setSitemapConfig(null));

  test("generate per host, serve by Host header, parts, unknown host 404, robots", async () => {
    const { fetch } = await boot(twoDomains("sm-public"));
    const results = await generateToDisk(twoDomains("sm-public"));
    expect(results.map((r) => [r.domain.host, r.result.urls])).toEqual([
      ["a.com", 3],
      ["b.com", 1],
    ]);
    const a = await fetch(new Request("http://a.com/sitemap.xml"));
    expect(a.status).toBe(200);
    const index = await a.text();
    expect(index).toContain("<loc>https://a.com/sitemap-2.xml.gz</loc>");
    const part = await fetch(new Request("http://a.com/sitemap-2.xml.gz"));
    expect(part.status).toBe(200);
    expect(
      dec.decode(await gunzip(new Uint8Array(await part.arrayBuffer()))),
    ).toContain("https://a.com/z");
    const b = await (
      await fetch(new Request("http://b.com/sitemap.xml"))
    ).text();
    expect(b).toContain("<loc>https://b.com/</loc>");
    expect(
      (await fetch(new Request("http://nope.com/sitemap.xml"))).status,
    ).toBe(404);
    expect(
      (await fetch(new Request("http://a.com/sitemap-9.xml"))).status,
    ).toBe(404);
    expect(
      await (await fetch(new Request("http://b.com/robots.txt"))).text(),
    ).toBe("User-agent: *\nAllow: /\n\nSitemap: https://b.com/sitemap.xml\n");
    expect(await fake.exists("sitemaps/a.com/sitemap-1.xml.gz")).toBe(true);
  });

  test("not generated → 404; custom path; enabled:false → no route", async () => {
    const custom = await boot({
      disk: "sm-public",
      baseUrl: "https://c.com",
      path: "map.xml",
      route: { path: "/seo/map.xml" },
    });
    expect(
      (await custom.fetch(new Request("http://c.com/seo/map.xml"))).status,
    ).toBe(404);
    await generateToDisk({
      disk: "sm-public",
      baseUrl: "https://c.com",
      path: "map.xml",
      build: (s) => void s.add("/q"),
    });
    const ok = await custom.fetch(new Request("http://c.com/seo/map.xml"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("https://c.com/q");
    const off = await boot({
      disk: "sm-public",
      baseUrl: "https://c.com",
      route: { enabled: false },
    });
    expect(off.app.router.getRoutes().some((r) => r.name === "sitemap")).toBe(
      false,
    );
  });

  test("command: registered, --dry-run, --domain, unknown domain exit 1", async () => {
    await boot(twoDomains("sm-public"));
    const run = async (...args: string[]) => {
      const cmd = new SitemapGenerateCommand();
      cmd.bindInput(args);
      const lines: string[] = [];
      const orig = [console.log, console.error];
      console.log = (...a: unknown[]) => void lines.push(a.join(" "));
      console.error = console.log;
      try {
        return { code: await cmd.handle(), lines };
      } finally {
        [console.log, console.error] = orig as [
          typeof console.log,
          typeof console.error,
        ];
      }
    };
    const dry = await run("--dry-run");
    expect(dry.code).toBe(0);
    expect(dry.lines.join("\n")).toContain("a.com: 3 URLs (dry run)");
    const one = await run("--domain=b.com");
    expect(one.code).toBe(0);
    expect(one.lines.join("\n")).toContain("b.com: 1 URLs");
    expect(one.lines.join("\n")).not.toContain("a.com");
    expect((await run("--domain=x.com")).code).toBe(1);
    expect((await run("--path=../x.xml")).code).toBe(1);
    expect(await dryRun(twoDomains("sm-public"), "a.com")).toEqual([
      { host: "a.com", urls: 3 },
    ]);
  });
});

void BunyadRequest;
