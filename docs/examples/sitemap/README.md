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
curl -H "Host: shop.example.test" localhost:3000/sitemap-1.xml.gz | gunzip | head
curl -H "Host: blog.example.test" localhost:3000/robots.txt
```

Output (`public/`, git-ignored):

```
public/sitemaps/blog.example.test/sitemap.xml        # index
public/sitemaps/blog.example.test/sitemap-1.xml.gz   # 20,000 URLs each
...
public/sitemaps/shop.example.test/sitemap.xml
```

`serve.ts` boots a Bunyad `Application` with `SitemapServiceProvider`, exactly
as an app would: the provider registers `/sitemap.xml`, the part route and
`/robots.txt`, and picks the set by `Host` (unknown hosts get 404). In an app,
`config` lives in `config/sitemap.ts` and you run `bunyad sitemap:generate`.
