---
title: Sitemaps
description: Generate XML sitemaps from routes and models, split and gzip large sets, serve them per domain, and keep them fresh on a schedule.
---

# Sitemaps

## Introduction

`@bunyad/sitemap` writes [sitemaps.org](https://www.sitemaps.org/protocol.html) XML sitemaps. Its API follows [spatie/laravel-sitemap](https://github.com/spatie/laravel-sitemap) (v8.2.0), but it streams: URLs are pulled from routes and models while the file is being written, so a million-row table costs about the same memory as a hundred rows when you write to a local disk.

Past 50,000 URLs or 50 MB (uncompressed) per file, the writer splits the set into `sitemap-1.xml`, `sitemap-2.xml`, … and writes a `sitemap.xml` index that points at them.

```shell
bun add @bunyad/sitemap
```

The core (`@bunyad/sitemap`) has no dependencies and runs on Bun and Node. Integrations live in subpaths:

| Import                     | Provides                                               | Needs                |
| -------------------------- | ------------------------------------------------------ | -------------------- |
| `@bunyad/sitemap`          | `Sitemap`, `SitemapIndex`, `Url`, `SitemapTag`, writer | —                    |
| `@bunyad/sitemap/orm`      | `fromModel`                                            | `@bunyad/orm`        |
| `@bunyad/sitemap/router`   | `fromRoutes`, `sitemapRoutes`, `withRoot`              | `@bunyad/router`     |
| `@bunyad/sitemap/disk`     | `writeToDisk`, `diskSink`                              | `@bunyad/filesystem` |
| `@bunyad/sitemap/http`     | `toResponse`, `serveSitemapFile`                       | —                    |
| `@bunyad/sitemap/command`  | `sitemap:generate`, `generateToDisk`                   | `@bunyad/cli`        |
| `@bunyad/sitemap/provider` | `SitemapServiceProvider`                               | `@bunyad/core`       |
| `@bunyad/sitemap/robots`   | robots.txt builder, `robotsFor`                        | —                    |

## Quick start

Register the provider in `bootstrap/providers.ts` and publish the config:

```ts title="bootstrap/providers.ts"
import { SitemapServiceProvider } from "@bunyad/sitemap/provider";

export function registerProviders(app: Application): void {
  app.register(SitemapServiceProvider);
}
```

```shell
bunyad publish --tag=sitemap-config
```

This creates `config/sitemap.ts`. Set `baseUrl` and describe what goes in the sitemap:

```ts title="config/sitemap.ts"
import type { SitemapConfig } from "@bunyad/sitemap";
import { fromModel } from "@bunyad/sitemap/orm";
import { fromRoutes } from "@bunyad/sitemap/router";
import { Post } from "@/Models/Post.ts";

const config: SitemapConfig = {
  disk: "public",
  baseUrl: "https://example.com",
  build: (sitemap) => {
    sitemap.add(fromRoutes({ except: ["sitemap*"] }));
    sitemap.add(fromModel(Post, { query: (q) => q.where("published", true) }));
  },
};

export default config;
```

Generate the files, then fetch them:

```shell
bunyad sitemap:generate
curl https://example.com/sitemap.xml
```

The provider registers `GET /sitemap.xml` (named `sitemap`) and a route for split parts (`sitemap.part`). Both read the generated files from the disk; requests never rebuild the sitemap.

## Building a sitemap by hand

```ts
import { Sitemap, Url } from "@bunyad/sitemap";

await Sitemap.create({ baseUrl: "https://example.com" })
  .add("/")
  .add(
    Url.create("/about")
      .setLastModificationDate(new Date())
      .setChangeFrequency("monthly")
      .setPriority(0.8),
  )
  .writeToFile("public/sitemap.xml");
```

`add()` accepts a string, a `Url`, anything with `toSitemapTag()`, arrays of those, and sync or async iterables. Iterables are pulled only while writing. Use `render()` for a small sitemap in memory, `stream()` for a `ReadableStream`, and `writeToFile()` or `writeToDisk()` for anything that may split.

`changefreq` and `priority` are written only when you set them, per URL or through `defaults` in the config. Google ignores both.

## Models

Give a model a `toSitemapTag()` method and pass the class to `fromModel`:

```ts
import { Model } from "@bunyad/orm";
import { Url } from "@bunyad/sitemap";

export class Post extends Model {
  toSitemapTag() {
    return Url.create(`/posts/${this.slug}`).setLastModificationDate(
      this.updated_at,
    );
  }
}
```

```ts
import { fromModel } from "@bunyad/sitemap/orm";

sitemap.add(
  fromModel(Post, { query: (q) => q.where("published", true), chunk: 1000 }),
);
```

`fromModel` reads rows with `lazyById` (keyset pages, one query per `chunk` rows), so it never loads the whole table. Pass `map` instead of defining `toSitemapTag()`. It may return a string, a `Url`, an array of them, or `null` to skip a row. `column` changes the keyset column (default `id`).

## Routes

```ts
import { fromRoutes } from "@bunyad/sitemap/router";

sitemap.add(
  fromRoutes({
    only: ["home", "posts.*"],
    except: ["posts.drafts"],
    params: {
      "posts.show": () => [{ post: "hello-world" }, { post: "release-notes" }],
    },
  }),
);
```

`fromRoutes` includes named `GET` routes only. It skips routes behind `auth`, `guest`, `signed` or `verified` middleware. Routes with parameters are included only when `params` supplies values for them. Domain routes are matched against the domain being generated; templated domains (`{account}.example.com`) are skipped.

URLs come from `route(name, params, true)`, scoped with `Url.withRoot(baseUrl)`. Each domain gets its own base URL, even when several are generated at once, and `APP_URL` is never read.

## Multiple domains

Replace `baseUrl` and `build` with `domains`:

```ts title="config/sitemap.ts"
const config: SitemapConfig = {
  domains: {
    "example.com": {
      baseUrl: "https://example.com",
      build: (s) => void s.add(fromRoutes({ host: "example.com" })),
    },
    "shop.example.com": {
      baseUrl: "https://shop.example.com",
      build: (s) => void s.add(fromModel(Product)),
    },
  },
};
```

Each host is written to `sitemaps/<host>/` on the disk. The auto-route picks the set by the request's `Host` header, so `https://shop.example.com/sitemap.xml` serves `sitemaps/shop.example.com/sitemap.xml`. Unknown hosts get a 404. A URL whose host belongs to another domain triggers a warning (or an error with `strict: true`).

Generate one domain at a time with `bunyad sitemap:generate --domain=shop.example.com`.

## Large sitemaps and gzip

```ts
const config: SitemapConfig = {
  gzip: true,
  maxTagsPerSitemap: 50_000,
  // …
};
```

With `gzip: true`, split parts are written as `sitemap-N.xml.gz`. The root `sitemap.xml` (the file or the index) always stays plain XML, because that is the URL you submit to search engines.

## Output layout and publishing

- **Single domain:** files sit at the configured `path` on the disk, e.g. `sitemap.xml`, `sitemap-1.xml.gz`, `sitemap-2.xml.gz`.
- **Multi-domain:** one set per host under `sitemaps/<host>/`.
- **Publish order:** every file is written under a temp name first. Parts are renamed into place, then the root or index is renamed last. Each rename is atomic, but the set as a whole is not: while parts are being swapped, an old index can point at a part that already holds new content. Crawlers always see complete files, never a half-written one.
- **gzip and part 1:** the writer cannot know whether a set will split until URL 50,001 arrives, so part 1 is written plain and gzipped once part 2 starts. That re-reads at most 50 MB once per run; parts 2 onward are compressed as they are written.
- **Stale parts:** the writer keeps a `.sitemap.manifest.json` next to the root file and deletes only parts it published in the previous run (for example when the set shrinks from 5 parts to 3). Other files in the directory, including an unrelated `sitemap-9.xml`, are never touched. A missing or corrupt manifest deletes nothing.

## Serving

The provider's auto-route serves files from the disk with:

- `Content-Type: application/xml; charset=utf-8` (`application/gzip` for `.xml.gz` parts);
- `Cache-Control` from `cache` (default `public, max-age=3600, stale-while-revalidate=86400`);
- `ETag` and `Last-Modified`, with `304` responses;
- `X-Robots-Tag: noindex`, so the sitemap itself is not indexed;
- `HEAD` support.

Change the path with `route: { path: "/maps/sitemap.xml" }` or turn the route off with `route: { enabled: false }` and serve the files yourself.

To render a small sitemap on each request instead, return `toResponse()` from a route. It streams the body and gzips it when the client accepts gzip:

```ts
import { toResponse } from "@bunyad/sitemap/http";

Route.get("/news-sitemap.xml", (request) =>
  toResponse(
    Sitemap.create({ baseUrl: "https://example.com" }).add(latestNews()),
    request,
  ),
);
```

## robots.txt

Set `robots: { enabled: true }` and the provider serves `GET /robots.txt` with your `rules` and one `Sitemap:` line per domain. To build it yourself, use `robotsFor(config)` from `@bunyad/sitemap/robots`.

## The generate command

```shell
bunyad sitemap:generate [--domain=] [--disk=] [--path=] [--gzip] [--dry-run]
```

| Option      | Effect                               |
| ----------- | ------------------------------------ |
| `--domain=` | Generate one configured host only    |
| `--disk=`   | Override `disk`                      |
| `--path=`   | Override the root file path          |
| `--gzip`    | gzip split parts for this run        |
| `--dry-run` | Count URLs per domain; write nothing |

It exits with `0` on success and `1` on an error (for example an unknown `--domain`).

## Scheduling

Regenerate on a timetable from `routes/console.ts`. `schedule().command()` runs built-in CLI commands only, so call `generateToDisk` directly:

```ts title="routes/console.ts"
import { schedule } from "@bunyad/schedule";
import { generateToDisk } from "@bunyad/sitemap/command";
import sitemap from "../config/sitemap.ts";

export function registerSchedule(): void {
  schedule()
    .call(async () => {
      await generateToDisk(sitemap);
    })
    .dailyAt("03:00")
    .name("sitemap:generate")
    .withoutOverlapping()
    .onOneServer();
}
```

Or run `bunyad sitemap:generate` from cron or your deploy script.

## Memory and S3

Writing to a local path (`writeToFile`, or `writeToDisk` on a local disk) streams with flat memory: 1,000,000 SQLite rows through `fromModel` grow RSS by about 30 MB on Bun.

The S3 disk's `writeStream` still **buffers each file in memory** before uploading, up to about 50 MB per part (the sitemaps.org limit), until multipart upload lands in `@bunyad/filesystem`. Memory stays bounded by one part, not by the whole set, but it is not flat. For very large sets on S3, generate to a local disk and sync, or budget for one part in memory per run.

## Differences from spatie/laravel-sitemap

1. All I/O is `async`. `add()` also takes sync and async iterables, which are pulled only while writing.
2. The writer streams and splits automatically on URL count **or** 50 MB, and writes an index.
3. gzip is built in and opt-in, for split parts only.
4. `changefreq` and `priority` are written only when set (per URL or through `defaults`).
5. Images are written as `<image:loc>` only. The deprecated `caption`, `title`, `geo_location` and `license` subtags are dropped.
6. `Tags\Sitemap` is exported as `SitemapTag`.
7. Dates accept `Date | string | number` and are written in W3C format with `+00:00`.
8. Multi-domain output and `robots.txt` are built in. `APP_URL` is never read; every set uses its configured `baseUrl`.
9. The crawler (`SitemapGenerator::create($url)`) is not part of v1.

See `docs/examples/sitemap` in the repository for a runnable two-domain example with 100,000 seeded rows.
