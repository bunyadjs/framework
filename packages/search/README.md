# @bunyad/search

Full-text search for Bunyad models: index records, then query them through a fluent builder, with an in-memory collection engine plus Algolia and Meilisearch drivers.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/search@beta
# or: npm install @bunyad/search@beta
```

## Usage

```ts
import { Builder, Search, searchable } from "@bunyad/search";

Search.configure({ driver: "collection" }); // in-memory engine, no services needed

const post = (id: number, title: string, userId: number) => ({
  id,
  searchableAs: () => "posts", // index name
  toSearchableArray: () => ({ id, title, user_id: userId }),
});

for (const p of [post(1, "Star Trek", 1), post(2, "Star Wars", 2), post(3, "Dune", 1)]) {
  await searchable(p).searchable(); // add to the index
}

class Post {
  static table = "posts";
  static searchableAs() { return "posts"; }
}

const hits = await new Builder(Post, "star").get();
console.log(hits.map((h) => h.id).sort()); // [ 1, 2 ]

const mine = await new Builder(Post, "star").where("user_id", 2).get();
console.log(mine.map((h) => h.title)); // [ "Star Wars" ]

await searchable(post(1, "Star Trek", 1)).unsearchable(); // remove from the index
console.log((await new Builder(Post, "star").get()).length); // 1
```

## Notes

- Runs on Bun only (1.4 or newer). No peer dependencies; the Algolia and Meilisearch engines use `fetch`.
- Drivers: `collection` (default), `algolia`, `meilisearch`, or your own via `Search.extend()`. Set `driver` in `Search.configure()` or the `SEARCH_DRIVER` env var.
- Algolia reads `ALGOLIA_APP_ID` / `ALGOLIA_SECRET`; Meilisearch reads `MEILISEARCH_HOST` / `MEILISEARCH_KEY` (or pass them to `Search.configure()` / the engine constructor).
- Builder methods: `where`, `whereIn`, `take`, `first`, `get`, `keys`, `raw`. Model classes can use the `Searchable` mixin for a static `search()`.

## License

MIT
