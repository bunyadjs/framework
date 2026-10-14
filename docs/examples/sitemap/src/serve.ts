/**
 * bun src/serve.ts — boot a Bunyad app with SitemapServiceProvider, which
 * registers /sitemap.xml, the part route and /robots.txt, served per Host:
 *   curl -H "Host: shop.example.test" localhost:3000/sitemap.xml
 *   curl -H "Host: shop.example.test" localhost:3000/sitemap-1.xml.gz | gunzip | head
 *   curl -H "Host: blog.example.test" localhost:3000/robots.txt
 * Run `bun run generate` first; requests only read the generated files.
 */
import { Application, createFetchHandler } from "@bunyad/core";
import { setStorage, StorageManager } from "@bunyad/filesystem";
import { Router } from "@bunyad/router";
import { SitemapServiceProvider } from "@bunyad/sitemap/provider";
import { config, disk } from "./app.ts";

setStorage(new StorageManager({ default: "public", disks: { public: disk } }));

const app = new Application({
  router: new Router(),
  config: { app: { port: 3000 }, sitemap: config },
});
app.register(SitemapServiceProvider);
await app.boot();

const handle = createFetchHandler(app);
Bun.serve({ port: 3000, fetch: (request) => handle(request) });
console.log("http://localhost:3000/sitemap.xml (send a Host header)");
