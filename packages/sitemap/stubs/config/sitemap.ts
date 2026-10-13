import type { SitemapConfig } from "@bunyad/sitemap";
import { fromRoutes } from "@bunyad/sitemap/router";
// import { fromModel } from "@bunyad/sitemap/orm";
// import { Post } from "../app/Models/Post.ts";

/**
 * Sitemap config (`bunyad sitemap:generate`, scheduled e.g. daily).
 * Output: `sitemap.xml` on the public disk; split + index past 50,000 URLs / 50 MB.
 */
const config: SitemapConfig = {
  disk: "public",
  path: "sitemap.xml",
  /** true → split parts are written as .xml.gz; the root sitemap.xml stays plain. */
  gzip: false,
  maxTagsPerSitemap: 50_000,
  stylesheet: null,
  /** Emitted only when non-null (Google ignores both). */
  defaults: { changefreq: null, priority: null },
  /** Auto-registered GET route serving the generated files; enabled: false to disable. */
  route: { enabled: true, path: "/sitemap.xml" },
  /** Optional GET /robots.txt with one Sitemap: line per domain (off by default). */
  robots: {
    enabled: false,
    path: "/robots.txt",
    rules: [{ userAgent: "*", allow: ["/"] }],
  },
  cache: { maxAge: 3600, staleWhileRevalidate: 86400 },

  // Single domain (never read from APP_URL):
  baseUrl: "https://example.com",
  build: (sitemap) => {
    sitemap.add(fromRoutes({ except: ["sitemap*"] }));
    // sitemap.add(fromModel(Post, { query: (q) => q.where("published", true) }));
  },

  // Or multi-domain (each host → sitemaps/<host>/):
  // domains: {
  //   "example.com": { baseUrl: "https://example.com", build: (s) => void s.add(fromRoutes({ host: "example.com" })) },
  //   "shop.example.com": { baseUrl: "https://shop.example.com", build: (s) => void s.add(fromRoutes({ host: "shop.example.com" })) },
  // },
};

export default config;
