/**
 * `@bunyad/sitemap/orm` — model source (T2.1). Iterates with `lazyById`, so
 * memory is O(chunk) and paging is keyset-stable under concurrent writes.
 */
import type { Model } from "@bunyad/orm";
import { toUrls, type Sitemapable } from "./sitemap.ts";
import type { Url } from "./url.ts";

type ModelClass = typeof Model;
type QueryOf<M extends ModelClass> = ReturnType<M["query"]>;
type InstanceOf<M extends ModelClass> = InstanceType<M>;

export type FromModelOptions<M extends ModelClass> = {
  /** Narrow the query, e.g. `(q) => q.where("published", true)`. */
  query?: (query: QueryOf<M>) => QueryOf<M>;
  /** Rows per page (default 1000). */
  chunk?: number;
  /** Keyset column (default: primary key). */
  column?: string;
  /** Row → tag(s); `null` skips. Default: `row.toSitemapTag()`. */
  map?: (
    row: InstanceOf<M>,
  ) => Url | string | Array<Url | string> | null | undefined;
};

export type { Sitemapable };

/** `Sitemap.create().add(fromModel(Post, { query: (q) => q.where("published", true) }))` */
export async function* fromModel<M extends ModelClass>(
  model: M,
  options: FromModelOptions<M> = {},
): AsyncGenerator<Url> {
  const base = model.query() as QueryOf<M>;
  const query = options.query ? options.query(base) : base;
  const rows = (
    query as unknown as {
      lazyById(chunk: number, column?: string): AsyncIterable<unknown>;
    }
  ).lazyById(options.chunk ?? 1000, options.column);
  for await (const row of rows) {
    let tag: unknown;
    if (options.map) {
      tag = options.map(row as InstanceOf<M>);
    } else if (
      typeof (row as Partial<Sitemapable>).toSitemapTag === "function"
    ) {
      tag = (row as Sitemapable).toSitemapTag();
    } else {
      throw new TypeError(
        `${model.name} must implement toSitemapTag() or pass a map option to fromModel().`,
      );
    }
    for (const url of toUrls(tag)) yield url;
  }
}
