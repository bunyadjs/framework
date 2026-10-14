# @bunyad/sitemap

Streaming, zero-dependency XML sitemaps for Bunyad (Bun + Node ≥ 22.6), with the
[spatie/laravel-sitemap](https://github.com/spatie/laravel-sitemap) API (reference: v8.2.0).

- Automatic split + index at 50,000 URLs or 50 MB (uncompressed), with memory that stays flat for millions of URLs
- Optional gzip of split parts (`.xml.gz`); the root `sitemap.xml` is always plain XML
- Atomic publish: parts first, index last, stale parts removed
- Multi-domain: one sitemap set and base URL per host, independent of `APP_URL`
- `@bunyad/sitemap/robots`: robots.txt builder with one `Sitemap:` line per domain

```ts
import { Sitemap, Url } from "@bunyad/sitemap";

await Sitemap.create({ baseUrl: "https://example.com" })
  .add("/")
  .add(Url.create("/about").setLastModificationDate(new Date()))
  .add(postsAsyncIterable) // pulled lazily while writing
  .writeToFile("public/sitemap.xml", { gzip: true });
```

```ts
import { robots, robotsFor } from "@bunyad/sitemap/robots";

robots()
  .userAgent("*")
  .disallow("/admin")
  .sitemap("https://example.com/sitemap.xml")
  .toString();
robotsFor({
  domains: {
    "a.com": { baseUrl: "https://a.com" },
    "b.com": { baseUrl: "https://b.com" },
  },
});
```

## Differences from spatie/laravel-sitemap

1. All I/O is `async`; `add()` also takes (async) iterables, pulled only while writing.
2. Streaming writer: the manual and model paths split automatically on count **or** 50 MB and write an index.
3. gzip is built in and opt-in (split parts only).
4. `changefreq` / `priority` are emitted only when set (per URL or config defaults); Google ignores both.
5. Images are `<image:loc>` only; the deprecated `caption` / `title` / `geo_location` / `license` subtags are dropped.
6. `Tags\Sitemap` is exported as `SitemapTag`.
7. Dates accept `Date | string | number` and are written as W3C Datetime (`+00:00`).

## Memory note

Writing to a local path (`writeToFile`, local disk) streams with flat memory. The S3 disk's
`writeStream` still buffers each file (≤ 50 MB per part) until multipart upload lands.

Benchmarks (`bun run bench`, `bench:node`, `bench:model`, `bench:model:node`) report
**retained** heap growth, measured right after a forced GC every 50,000 URLs, plus RSS
sampled at the same points. Neither is a true peak: memory between samples can be higher.
The gate is retained heap ≤ 50 MB on both runtimes (RSS also gated on Bun).

## Output layout and publishing

- **Single domain** (`baseUrl` + `build`): files at the disk root, e.g. `public/sitemap.xml`, `public/sitemap-1.xml.gz`.
- **Multi-domain** (`domains`): one set per host under `sitemaps/<host>/` (e.g. `sitemaps/shop.example.com/sitemap.xml`); the auto-route serves it at `https://<host>/sitemap.xml` by `Host`.
- **Publish order**: every file is written to a temp name first. Parts are renamed into place, then the root/index is renamed last. Each rename is atomic, but the set is not: while parts are being swapped, an old index can point at a part that already has new content. Same URLs, fresh content, never a half-written file.
- **gzip**: part 1 is written plain (the writer cannot know yet whether the set will split) and is gzipped once a second part starts. This re-reads ≤ 50 MB once per run; parts 2+ are compressed on the fly.
- **Stale parts**: the writer keeps a `.sitemap.manifest.json` (per root file name) and only deletes parts it published before. Unrelated `sitemap-N.xml` files in the same directory are never touched.
