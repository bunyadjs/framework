/** Node mirror of integrations.test.ts: ORM (sqlite), router, memory disk, http. */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  connectSqlite,
  listen,
  schemaFor,
  type Connection,
} from "@bunyad/database";
// The package root imports Bun's S3 client; the memory disk itself is portable.
import { MemoryFilesystem } from "../../filesystem/src/memory-filesystem.ts";
import { Model } from "@bunyad/orm";
import { Route, Router, setActiveRouter } from "@bunyad/router";
import { safeDiskPath, writeToDisk } from "./disk.ts";
import { serveSitemapFile, toResponse } from "./http.ts";
import { fromModel } from "./orm.ts";
import { fromRoutes, routerScope, sitemapRoutes } from "./router.ts";
import { Sitemap } from "./sitemap.ts";
import { Url } from "./url.ts";

const dec = new TextDecoder();
async function collect(it: AsyncIterable<Url>): Promise<string[]> {
  const out: string[] = [];
  for await (const u of it) out.push(u.url);
  return out;
}

class SmNodePost extends Model {
  static table = "sm_node_posts";
  static fillable = ["slug"];
  declare id: number;
  declare slug: string;
  toSitemapTag() {
    return Url.create(`/posts/${this.slug}`);
  }
}

describe("fromModel (node sqlite)", () => {
  let c: Connection;
  before(async () => {
    c = connectSqlite();
    Model.setConnection(c);
    await schemaFor(c).create("sm_node_posts", (b) => {
      b.id();
      b.string("slug");
    });
    for (let i = 0; i < 2500; i += 250) {
      const ids = Array.from({ length: 250 }, (_, j) => `p${i + j + 1}`);
      await c.run(
        `INSERT INTO sm_node_posts (slug) VALUES ${ids.map(() => "(?)").join(",")}`,
        ids,
      );
    }
  });
  after(async () => {
    await schemaFor(c).dropIfExists("sm_node_posts");
  });

  it("keyset pages and map", async () => {
    let selects = 0;
    const off = listen((e) => {
      if (/^\s*SELECT/i.test(e.sql)) selects++;
    });
    const urls = await collect(fromModel(SmNodePost));
    off();
    assert.equal(urls.length, 2500);
    assert.equal(urls[0], "/posts/p1");
    assert.equal(selects, 3);
    const mapped = await collect(
      fromModel(SmNodePost, {
        query: (q) => q.where("id", "<=", 2),
        map: (p) => [`/a/${p.id}`],
      }),
    );
    assert.deepEqual(mapped, ["/a/1", "/a/2"]);
  });

  it("writeToDisk on a memory disk with parts", async () => {
    const disk = new MemoryFilesystem();
    const r = await writeToDisk(
      Sitemap.create({ baseUrl: "https://e.com" })
        .maxTagsPerSitemap(1000)
        .add(fromModel(SmNodePost)),
      disk,
      "sitemap.xml",
    );
    assert.equal(r.urls, 2500);
    assert.equal(r.files.length, 3);
  });
});

describe("fromRoutes (node)", () => {
  const router = new Router();
  before(() => {
    setActiveRouter(router);
    router.get("/", () => "home").name("home");
    router.get("/posts/{post}", () => "x").name("posts.show");
    router
      .get("/admin", () => "x")
      .name("admin")
      .middleware("auth");
  });
  after(() => setActiveRouter(Route));

  it("filters and scopes the root per domain", async () => {
    assert.deepEqual(
      sitemapRoutes({ router }).map((r) => r.name),
      ["home"],
    );
    const [a, b] = await Promise.all([
      routerScope("https://a.com", () =>
        collect(
          fromRoutes({
            router,
            params: { "posts.show": () => [{ post: 1 }] },
          }),
        ),
      ),
      routerScope("https://b.com", () =>
        collect(fromRoutes({ router, only: ["home"] })),
      ),
    ]);
    assert.deepEqual(a, ["https://a.com/", "https://a.com/posts/1"]);
    assert.deepEqual(b, ["https://b.com/"]);
  });
});

describe("disk + http (node)", () => {
  it("gzip parts on memory disk; traversal rejected", async () => {
    const disk = new MemoryFilesystem();
    await writeToDisk(
      Sitemap.create({ baseUrl: "https://e.com" })
        .maxTagsPerSitemap(2)
        .add(["/a", "/b", "/c"]),
      disk,
      "maps/sitemap.xml",
      { gzip: true, publicUrl: "https://e.com/maps/" },
    );
    assert.match(
      dec.decode(gunzipSync(await disk.get("maps/sitemap-2.xml.gz"))),
      /https:\/\/e\.com\/c/,
    );
    assert.throws(() => safeDiskPath("../x.xml"));
  });

  it("toResponse gzip negotiation and serveSitemapFile 304/404", async () => {
    const sitemap = Sitemap.create({ baseUrl: "https://e.com" }).add(["/a"]);
    const gz = toResponse(
      sitemap,
      new Request("https://e.com/", {
        headers: { "accept-encoding": "gzip" },
      }),
    );
    assert.equal(gz.headers.get("Content-Encoding"), "gzip");
    assert.equal(
      dec.decode(gunzipSync(new Uint8Array(await gz.arrayBuffer()))),
      sitemap.render(),
    );
    const disk = new MemoryFilesystem();
    assert.equal((await serveSitemapFile(disk, "sitemap.xml")).status, 404);
    await disk.put("sitemap.xml", "<urlset/>");
    const ok = await serveSitemapFile(disk, "sitemap.xml");
    assert.equal(ok.status, 200);
    const etag = ok.headers.get("ETag") ?? "";
    const again = await serveSitemapFile(
      disk,
      "sitemap.xml",
      new Request("https://e.com", { headers: { "if-none-match": etag } }),
    );
    assert.equal(again.status, 304);
  });
});
