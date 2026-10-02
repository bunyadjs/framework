import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AlgoliaEngine,
  Builder,
  CollectionEngine,
  MeilisearchEngine,
  Search,
  Searchable,
  makeAllSearchable,
  scoutKey,
  searchable,
  searchableIndex,
  toSearchDocument,
  type FetchLike,
  type SearchableModel,
} from "./index.ts";

const ENV_KEYS = [
  "ALGOLIA_APP_ID",
  "ALGOLIA_SECRET",
  "SEARCH_ALGOLIA_ID",
  "SEARCH_ALGOLIA_SECRET",
  "SCOUT_ALGOLIA_ID",
  "SCOUT_ALGOLIA_SECRET",
  "MEILISEARCH_HOST",
  "MEILISEARCH_KEY",
  "SEARCH_MEILISEARCH_HOST",
  "SEARCH_MEILISEARCH_KEY",
  "SCOUT_MEILISEARCH_HOST",
  "SCOUT_MEILISEARCH_KEY",
  "SEARCH_DRIVER",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  Search.flush();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

type Call = { url: string; method?: string; headers: Record<string, string>; body: any };

function recorder(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchLike: FetchLike = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetchLike };
}

const doc = (id: number | string, extra: Record<string, unknown> = {}, index = "posts"): SearchableModel => ({
  id,
  searchableAs: () => index,
  toSearchableArray: () => ({ id, ...extra }),
});

class Posts {
  static searchableAs() {
    return "posts";
  }
}

describe("model key and document helpers", () => {
  test("scoutKey prefers getSearchKey, then getKey, then id, and stringifies", () => {
    expect(scoutKey({ id: 1, getKey: () => 2, getSearchKey: () => 3 })).toBe("3");
    expect(scoutKey({ id: 1, getKey: () => 2 })).toBe("2");
    expect(scoutKey({ id: 7 })).toBe("7");
    expect(scoutKey({ id: 0 })).toBe("0");
  });

  test("scoutKey throws when the model has no identity", () => {
    expect(() => scoutKey({ title: "x" })).toThrow("must have an id");
  });

  test("toSearchDocument falls back through toSearchableArray, toArray, then plain fields", () => {
    expect(
      toSearchDocument({ id: 1, toSearchableArray: () => ({ a: 1 }), toArray: () => ({ b: 2 }) }),
    ).toEqual({ a: 1, __scout_key: "1" });
    expect(toSearchDocument({ id: 1, toArray: () => ({ b: 2 }) })).toEqual({ b: 2, __scout_key: "1" });
    expect(toSearchDocument({ id: 1, name: "n", helper() {} })).toEqual({
      id: 1,
      name: "n",
      __scout_key: "1",
    });
  });

  test("searchableIndex applies the configured prefix", () => {
    Search.configure({ prefix: "staging_" });
    expect(searchableIndex({ searchableAs: () => "posts" })).toBe("staging_posts");
    expect(searchableIndex({}, { table: "users" })).toBe("staging_users");
    expect(searchableIndex({})).toBe("staging_default");
  });
});

describe("Search facade", () => {
  test("unsupported driver names fail with a helpful message", () => {
    Search.configure({ driver: "typesense" });
    expect(() => Search.engine()).toThrow("Unsupported Search driver [typesense]");
  });

  test("the engine is cached until configuration changes", () => {
    const a = Search.engine();
    expect(Search.engine()).toBe(a);
    Search.configure({ prefix: "p_" });
    expect(Search.engine()).not.toBe(a);
  });

  test("driver(name) builds a fresh engine without touching the active one", () => {
    const active = Search.engine();
    const other = Search.driver("null");
    expect(other).toBeInstanceOf(CollectionEngine);
    expect(other).not.toBe(active);
    expect(Search.engine()).toBe(active);
  });

  test("custom engines override built-in names, and flush() forgets them", () => {
    const custom = new CollectionEngine();
    Search.extend("collection", () => custom);
    expect(Search.driver("collection")).toBe(custom);
    Search.flush();
    expect(Search.driver("collection")).not.toBe(custom);
  });

  test("index prefix isolates indexes in the builder", async () => {
    Search.configure({ prefix: "a_" });
    await searchable(doc(1, { title: "Alpha" }) as SearchableModel).searchable();
    const inPrefix = await new Builder(Posts, "alpha").keys();
    expect(inPrefix).toEqual(["1"]);

    // Same engine instance, different prefix on the builder's index: nothing found.
    const engine = Search.engine();
    Search.configure({ prefix: "b_" });
    Search.extend("keep", () => engine);
    Search.configure({ driver: "keep" });
    expect(await new Builder(Posts, "alpha").keys()).toEqual([]);
  });

  test("SEARCH_DRIVER env var selects the driver when none is configured", () => {
    const custom = new CollectionEngine();
    Search.extend("from-env", () => custom);
    process.env.SEARCH_DRIVER = "from-env";
    try {
      expect(Search.engine()).toBe(custom);
    } finally {
      delete process.env.SEARCH_DRIVER;
    }
  });
});

describe("CollectionEngine", () => {
  test("matching is case-insensitive, AND across tokens, and spans every field", async () => {
    const engine = new CollectionEngine();
    await engine.update([
      doc(1, { title: "Star Trek", body: "Space exploration" }),
      doc(2, { title: "Star Wars", body: "Galactic empire" }),
    ]);
    const search = (query: string) =>
      engine.search({ index: "posts", query, wheres: {}, whereIns: {}, limit: null });

    expect((await search("STAR")).ids).toEqual(["1", "2"]);
    expect((await search("star space")).ids).toEqual(["1"]);
    expect((await search("  star   empire ")).ids).toEqual(["2"]);
    expect((await search("star nothing")).ids).toEqual([]);
    expect((await search("")).ids).toEqual(["1", "2"]);
  });

  test("updating the same key replaces the document, and ids keep insertion order", async () => {
    const engine = new CollectionEngine();
    await engine.update([doc(1, { title: "Old" }), doc(2, { title: "Other" })]);
    await engine.update([doc(1, { title: "New" })]);
    const res = await engine.search({ index: "posts", query: "", wheres: {}, whereIns: {}, limit: null });
    expect(res.ids).toEqual(["1", "2"]);
    expect(res.hits[0]?.title).toBe("New");
  });

  test("where uses strict equality and whereIn requires membership", async () => {
    const engine = new CollectionEngine();
    await engine.update([doc(1, { user_id: 1 }), doc(2, { user_id: 2 })]);
    const run = (wheres: Record<string, unknown>, whereIns: Record<string, unknown[]> = {}) =>
      engine.search({ index: "posts", query: "", wheres, whereIns, limit: null });

    expect((await run({ user_id: "1" })).ids).toEqual([]);
    expect((await run({ user_id: 1 })).ids).toEqual(["1"]);
    expect((await run({}, { user_id: [] })).ids).toEqual([]);
    expect((await run({ user_id: 2 }, { user_id: [1, 2] })).ids).toEqual(["2"]);
    expect((await run({ missing_field: undefined })).ids).toEqual(["1", "2"]);
  });

  test("limit slices after filtering; zero returns nothing", async () => {
    const engine = new CollectionEngine();
    await engine.update([1, 2, 3, 4].map((i) => doc(i, { title: "t", odd: i % 2 })));
    const run = (limit: number | null) =>
      engine.search({ index: "posts", query: "", wheres: { odd: 1 }, whereIns: {}, limit });
    expect((await run(1)).ids).toEqual(["1"]);
    expect((await run(0)).ids).toEqual([]);
    expect((await run(10)).ids).toEqual(["1", "3"]);
  });

  test("delete of an unknown key or index is a no-op; flush clears one index only", async () => {
    const engine = new CollectionEngine();
    await engine.update([doc(1, { title: "a" }), doc(1, { title: "b" }, "users")]);
    await engine.delete([doc(99), doc(1, {}, "nowhere")]);
    await engine.flush("posts");
    const posts = await engine.search({ index: "posts", query: "", wheres: {}, whereIns: {}, limit: null });
    const users = await engine.search({ index: "users", query: "", wheres: {}, whereIns: {}, limit: null });
    expect(posts.ids).toEqual([]);
    expect(users.ids).toEqual(["1"]);
  });
});

describe("Builder", () => {
  test("get() strips the internal key while keys() exposes it", async () => {
    await searchable(doc(4, { title: "Hello" })).searchable();
    const rows = await new Builder(Posts, "hello").get();
    expect(rows).toEqual([{ id: 4, title: "Hello" }]);
    expect(await new Builder(Posts, "hello").keys()).toEqual(["4"]);
  });

  test("within() overrides the index; first() restores a previously set limit and returns null on no match", async () => {
    await searchable(doc(1, { title: "x" }, "archive")).searchable();
    const builder = new Builder(Posts, "").within("archive").take(5);
    expect((await builder.first())?.id).toBe(1);
    expect(await new Builder(Posts, "zzz").within("archive").first()).toBeNull();
    expect(await new Builder(Posts, "").keys()).toEqual([]);
  });

  test("whereIn copies its input and a later call for the same field replaces the earlier one", async () => {
    await searchable(doc(1, { u: 1 })).searchable();
    await searchable(doc(2, { u: 2 })).searchable();
    const values = [1];
    const builder = new Builder(Posts, "").whereIn("u", values);
    values.push(2);
    expect(await builder.keys()).toEqual(["1"]);
    expect(await builder.whereIn("u", [2]).keys()).toEqual(["2"]);
  });

  test("limit() is an alias of take()", async () => {
    for (const id of [1, 2, 3]) await searchable(doc(id, { t: "x" })).searchable();
    expect(await new Builder(Posts, "").limit(2).keys()).toEqual(["1", "2"]);
  });

  test("makeAllSearchable requires a static all()", async () => {
    await expect(makeAllSearchable(Posts)).rejects.toThrow("requires a static all()");
  });

  test("Searchable mixin uses an own static searchableAs, otherwise the table", async () => {
    const Base = Searchable(
      class {
        id = 1;
        title = "mixin";
        static table = "base_table";
      },
    );
    class Plain extends Base {}
    class Custom extends Base {
      static searchableAs() {
        return "custom_index";
      }
    }
    expect(new Plain().searchableAs()).toBe("base_table");
    expect(new Custom().searchableAs()).toBe("custom_index");

    await new Custom().searchable();
    expect(await Custom.search("mixin").keys()).toEqual(["1"]);
    expect(await Plain.search("mixin").keys()).toEqual([]);
    await new Custom().unsearchable();
    expect(await Custom.search("mixin").keys()).toEqual([]);
  });

  test("an unsearchable model without an id fails loudly instead of indexing under 'undefined'", async () => {
    const Base = Searchable(class { title = "no id"; });
    await expect(new Base().searchable()).rejects.toThrow("must have an id");
  });
});

describe("AlgoliaEngine", () => {
  test("requires credentials", () => {
    expect(() => new AlgoliaEngine()).toThrow("requires id/secret");
    expect(() => new AlgoliaEngine({ id: "APP" })).toThrow("requires id/secret");
  });

  test("falls back to environment credentials", async () => {
    process.env.ALGOLIA_APP_ID = "ENVAPP";
    process.env.ALGOLIA_SECRET = "ENVKEY";
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    await new AlgoliaEngine({ fetch: fetchLike }).search({
      index: "posts", query: "q", wheres: {}, whereIns: {}, limit: null,
    });
    expect(calls[0]!.url).toBe("https://ENVAPP-dsn.algolia.net/1/indexes/posts/query");
    expect(calls[0]!.headers["X-Algolia-API-Key"]).toBe("ENVKEY");
  });

  test("writes go to the primary host and reads to the dsn host", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    const engine = new AlgoliaEngine({ id: "APP", secret: "KEY", fetch: fetchLike });
    await engine.update([doc(1, { title: "a" })]);
    await engine.search({ index: "posts", query: "", wheres: {}, whereIns: {}, limit: null });
    expect(calls[0]!.url).toBe("https://APP.algolia.net/1/indexes/posts/batch");
    expect(calls[1]!.url).toBe("https://APP-dsn.algolia.net/1/indexes/posts/query");
    expect(calls[0]!.body.requests[0]).toEqual({
      action: "updateObject",
      body: { id: 1, title: "a", __scout_key: "1", objectID: "1" },
    });
  });

  test("models are batched per index", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({}));
    const engine = new AlgoliaEngine({ id: "APP", secret: "KEY", fetch: fetchLike });
    await engine.update([doc(1, {}, "posts"), doc(2, {}, "users"), doc(3, {}, "posts")]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.requests.map((r: any) => r.body.objectID)).toEqual(["1", "3"]);
    expect(calls[1]!.url).toContain("/users/batch");
  });

  test("delete sends deleteObject actions", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({}));
    await new AlgoliaEngine({ id: "APP", secret: "KEY", fetch: fetchLike }).delete([doc(5)]);
    expect(calls[0]!.body).toEqual({ requests: [{ action: "deleteObject", body: { objectID: "5" } }] });
  });

  test("filters combine where and whereIn; hitsPerPage defaults to 20", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    const engine = new AlgoliaEngine({ id: "APP", secret: "KEY", fetch: fetchLike });
    await engine.search({
      index: "posts", query: "q",
      wheres: { author: "Ann", published: true },
      whereIns: { tag: ["a", "b"] },
      limit: null,
    });
    expect(calls[0]!.body).toEqual({
      query: "q",
      hitsPerPage: 20,
      filters: 'author:"Ann" AND published:true AND (tag:"a" OR tag:"b")',
    });
    await engine.search({ index: "posts", query: "", wheres: {}, whereIns: {}, limit: 3 });
    expect(calls[1]!.body).toEqual({ query: "", hitsPerPage: 3 });
  });

  test("hit keys come from objectID, and HTTP failures throw with the status", async () => {
    const ok = recorder(() => Response.json({ hits: [{ objectID: 9, title: "t" }, { title: "no id" }] }));
    const engine = new AlgoliaEngine({ id: "A", secret: "K", fetch: ok.fetchLike });
    const res = await engine.search({ index: "i", query: "", wheres: {}, whereIns: {}, limit: null });
    expect(res.ids).toEqual(["9", ""]);

    const bad = recorder(() => new Response("no", { status: 403 }));
    const failing = new AlgoliaEngine({ id: "A", secret: "K", fetch: bad.fetchLike });
    await expect(failing.update([doc(1)])).rejects.toThrow("Algolia update failed (403)");
    await expect(failing.delete([doc(1)])).rejects.toThrow("Algolia delete failed (403)");
    await expect(failing.flush("i")).rejects.toThrow("Algolia flush failed (403)");
    await expect(
      failing.search({ index: "i", query: "", wheres: {}, whereIns: {}, limit: null }),
    ).rejects.toThrow("Algolia search failed (403)");
  });
});

describe("MeilisearchEngine", () => {
  test("host defaults, trailing slash is trimmed, and the key becomes a bearer token", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    await new MeilisearchEngine({ host: "http://meili.test/", key: "k", fetch: fetchLike }).search({
      index: "posts", query: "", wheres: {}, whereIns: {}, limit: null,
    });
    expect(calls[0]!.url).toBe("http://meili.test/indexes/posts/search");
    expect(calls[0]!.headers.Authorization).toBe("Bearer k");

    const anon = recorder(() => Response.json({ hits: [] }));
    await new MeilisearchEngine({ fetch: anon.fetchLike }).search({
      index: "posts", query: "", wheres: {}, whereIns: {}, limit: null,
    });
    expect(anon.calls[0]!.url).toStartWith("http://127.0.0.1:7700/");
    expect(anon.calls[0]!.headers.Authorization).toBeUndefined();
  });

  test("update ensures the index with primaryKey id, then posts documents", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({}));
    await new MeilisearchEngine({ host: "http://m", fetch: fetchLike }).update([doc(3, { title: "t" })]);
    expect(calls[0]!.url).toBe("http://m/indexes");
    expect(calls[0]!.body).toEqual({ uid: "posts", primaryKey: "id" });
    expect(calls[1]!.url).toBe("http://m/indexes/posts/documents");
    expect(calls[1]!.body).toEqual([{ id: "3", title: "t", __scout_key: "3" }]);
  });

  test("an already-existing index (409) does not abort update", async () => {
    const { fetchLike, calls } = recorder((call) =>
      call.url.endsWith("/indexes") ? new Response("exists", { status: 409 }) : Response.json({}),
    );
    await new MeilisearchEngine({ host: "http://m", fetch: fetchLike }).update([doc(1)]);
    expect(calls).toHaveLength(2);
  });

  test("index names are URL-encoded", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    await new MeilisearchEngine({ host: "http://m", fetch: fetchLike }).search({
      index: "my index/x", query: "", wheres: {}, whereIns: {}, limit: null,
    });
    expect(calls[0]!.url).toBe("http://m/indexes/my%20index%2Fx/search");
  });

  test("filter syntax quotes strings, leaves numbers bare, and ORs whereIn values", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    await new MeilisearchEngine({ host: "http://m", fetch: fetchLike }).search({
      index: "posts", query: "q", wheres: { author: "Ann", n: 2 }, whereIns: { tag: ["a", 1] }, limit: 5,
    });
    expect(calls[0]!.body).toEqual({
      q: "q",
      limit: 5,
      filter: 'author = "Ann" AND n = 2 AND (tag = "a" OR tag = 1)',
    });
  });

  test("string filter values containing quotes are escaped", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [] }));
    await new MeilisearchEngine({ host: "http://m", fetch: fetchLike }).search({
      index: "posts", query: "", wheres: { author: 'x" OR private = "1' }, whereIns: {}, limit: null,
    });
    expect(calls[0]!.body.filter).toBe('author = "x\\" OR private = \\"1"');
  });

  test("flush tolerates a missing index (404) but not other failures; delete sends ids", async () => {
    const notFound = recorder(() => new Response("", { status: 404 }));
    const engine = new MeilisearchEngine({ host: "http://m", fetch: notFound.fetchLike });
    await engine.flush("gone");
    expect(notFound.calls[0]!.method).toBe("DELETE");

    const broken = recorder(() => new Response("", { status: 500 }));
    const failing = new MeilisearchEngine({ host: "http://m", fetch: broken.fetchLike });
    await expect(failing.flush("x")).rejects.toThrow("flush failed (500)");
    await expect(failing.delete([doc(1)])).rejects.toThrow("delete failed (500)");
    expect(broken.calls[0]!.url).toBe("http://m/indexes/x/documents");

    const ok = recorder(() => Response.json({}));
    await new MeilisearchEngine({ host: "http://m", fetch: ok.fetchLike }).delete([doc(1), doc(2)]);
    expect(ok.calls[0]!.url).toBe("http://m/indexes/posts/documents/delete-batch");
    expect(ok.calls[0]!.body).toEqual(["1", "2"]);
  });

  test("Search.setFetch is wired into the configured HTTP driver and reset by flush()", async () => {
    const { calls, fetchLike } = recorder(() => Response.json({ hits: [{ id: 1, title: "t" }] }));
    Search.setFetch(fetchLike);
    Search.configure({ driver: "meilisearch", meilisearch: { host: "http://cfg" } });
    expect(await new Builder(Posts, "t").keys()).toEqual(["1"]);
    expect(calls[0]!.url).toStartWith("http://cfg/");
  });
});
