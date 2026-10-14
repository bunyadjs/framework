import { connectSqlite, schemaFor } from "@bunyad/database";
import { LocalFilesystem } from "@bunyad/filesystem";
import { Model } from "@bunyad/orm";
import { Url, type SitemapConfig } from "@bunyad/sitemap";
import { fromModel } from "@bunyad/sitemap/orm";

export const ROWS = 100_000;

/** `site` picks the host a post belongs to: "blog" or "shop". */
export class Post extends Model {
  static table = "posts";
  declare id: number;
  declare site: string;
  declare slug: string;
  declare updated_at: string;
}

/** In-memory SQLite with 100k rows, half per domain. */
export async function seed(): Promise<void> {
  const c = connectSqlite();
  Model.setConnection(c);
  await schemaFor(c).create("posts", (b) => {
    b.id();
    b.string("site");
    b.string("slug");
    b.string("updated_at");
  });
  const BATCH = 2000;
  for (let i = 0; i < ROWS; i += BATCH) {
    const values: string[] = [];
    for (let j = i; j < Math.min(i + BATCH, ROWS); j++) {
      values.push(j % 2 ? "shop" : "blog", `item-${j + 1}`, "2026-10-14");
    }
    await c.run(
      `INSERT INTO posts (site, slug, updated_at) VALUES ${Array.from(
        { length: values.length / 3 },
        () => "(?, ?, ?)",
      ).join(",")}`,
      values,
    );
  }
}

const forSite = (site: string) =>
  fromModel(Post, {
    query: (q) => q.where("site", site),
    map: (p) => Url.create(`/${p.slug}`).setLastModificationDate(p.updated_at),
  });

/** Two hosts; each lands in sitemaps/<host>/ on the disk (50k URLs → 1 file, so split at 20k). */
export const config: SitemapConfig = {
  disk: "public",
  maxTagsPerSitemap: 20_000,
  gzip: true,
  robots: { enabled: true },
  domains: {
    "blog.example.test": {
      baseUrl: "https://blog.example.test",
      build: (s) => void s.add(forSite("blog")),
    },
    "shop.example.test": {
      baseUrl: "https://shop.example.test",
      build: (s) => void s.add(forSite("shop")),
    },
  },
};

export const disk = new LocalFilesystem({
  root: new URL("../public", import.meta.url).pathname,
});
