# Sitemap example: two domains, 100k rows

Seeds 100,000 posts into in-memory SQLite (half `blog`, half `shop`) and writes
one sitemap set per host with `@bunyad/sitemap`, streaming rows through
`fromModel` (keyset pages via `lazyById`). Bun only: it writes through
`LocalFilesystem`.

```shell
bun install            # from the monorepo root
cd docs/examples/sitemap
bun run generate
bun run serve          # then:
curl -H "Host: shop.example.test" localhost:3000/sitemap.xml
```

Output (`public/`, git-ignored):

```
public/sitemaps/blog.example.test/sitemap.xml        # index
public/sitemaps/blog.example.test/sitemap-1.xml.gz   # 20,000 URLs each
...
public/sitemaps/shop.example.test/sitemap.xml
```

In an app you would put `config` in `config/sitemap.ts`, register
`SitemapServiceProvider`, and run `bunyad sitemap:generate`; the provider then
serves `/sitemap.xml` per `Host` for you.
