/**
 * bun src/serve.ts — serve the generated files by Host, like the provider's auto-route:
 *   curl -H "Host: shop.example.test" localhost:3000/sitemap.xml
 */
import { serveSitemapFile } from "@bunyad/sitemap/http";
import { config, disk } from "./app.ts";

const hosts = new Set(
  Object.keys(config.domains ?? {}).map((h) => h.toLowerCase()),
);

Bun.serve({
  port: 3000,
  fetch(req) {
    const host = (req.headers.get("host") ?? "").split(":")[0] ?? "";
    const file = new URL(req.url).pathname.slice(1);
    if (!hosts.has(host)) return new Response("Not Found", { status: 404 });
    return serveSitemapFile(
      disk,
      `sitemaps/${host}/${file}`,
      req,
      config.cache,
    );
  },
});
console.log("http://localhost:3000/sitemap.xml (send a Host header)");
