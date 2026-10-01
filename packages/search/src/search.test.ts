import { afterEach, expect, test } from "bun:test";
import {
  Builder,
  CollectionEngine,
  Search,
  Searchable,
  searchable,
} from "./index.ts";

afterEach(() => {
  Search.flush();
});

type Post = {
  id: number;
  title: string;
  body: string;
  user_id: number;
  searchableAs(): string;
  toSearchableArray(): Record<string, unknown>;
};

function makePost(overrides: Partial<Post> & { id: number }): Post {
  return {
    title: "Hello",
    body: "World",
    user_id: 1,
    searchableAs() {
      return "posts";
    },
    toSearchableArray() {
      return {
        id: this.id,
        title: this.title,
        body: this.body,
        user_id: this.user_id,
      };
    },
    ...overrides,
  };
}

test("searchable indexes and Model.search finds matches", async () => {
  Search.configure({ driver: "collection" });
  const a = makePost({ id: 1, title: "Star Trek", body: "space" });
  const b = makePost({ id: 2, title: "Star Wars", body: "force" });
  const c = makePost({ id: 3, title: "Dune", body: "sand" });

  await searchable(a).searchable();
  await searchable(b).searchable();
  await searchable(c).searchable();

  class PostModel {
    static table = "posts";
    static searchableAs() {
      return "posts";
    }
  }

  const results = await new Builder(PostModel, "star").get();
  expect(results.map((r) => r.id).sort()).toEqual([1, 2]);
});

test("where filters and take limits", async () => {
  await searchable(
    makePost({ id: 1, title: "Alpha", user_id: 1 }),
  ).searchable();
  await searchable(
    makePost({ id: 2, title: "Alpha Two", user_id: 2 }),
  ).searchable();
  await searchable(
    makePost({ id: 3, title: "Beta", user_id: 1 }),
  ).searchable();

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }

  const filtered = await new Builder(PostModel, "alpha")
    .where("user_id", 1)
    .get();
  expect(filtered).toHaveLength(1);
  expect(filtered[0]?.id).toBe(1);

  const limited = await new Builder(PostModel, "").take(2).get();
  expect(limited).toHaveLength(2);
});

test("unsearchable removes from index", async () => {
  const post = makePost({ id: 10, title: "Remove me" });
  await searchable(post).searchable();

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }

  expect(await new Builder(PostModel, "remove").keys()).toEqual(["10"]);
  await searchable(post).unsearchable();
  expect(await new Builder(PostModel, "remove").keys()).toEqual([]);
});

test("Searchable mixin exposes static search", async () => {
  const rows: Array<{ id: number; title: string; searchable(): Promise<void> }> =
    [];

  class Post extends Searchable(
    class {
      id!: number;
      title!: string;
      body = "";
      user_id = 1;
      static table = "posts";

      static all() {
        return rows;
      }

      toSearchableArray() {
        return {
          id: this.id,
          title: this.title,
          body: this.body,
          user_id: this.user_id,
        };
      }
    },
  ) {}

  rows.length = 0;
  const p = new Post();
  p.id = 5;
  p.title = "Mixin Search";
  rows.push(p);
  await p.searchable();

  const hit = await Post.search("mixin").first();
  expect(hit?.title).toBe("Mixin Search");
  expect(hit?.id).toBe(5);

  await Post.makeAllSearchable();
  await Post.removeAllFromSearch();
  expect(await Post.search("mixin").keys()).toEqual([]);
});

test("Search.extend registers custom engine", async () => {
  const engine = new CollectionEngine();
  Search.extend("custom", () => engine);
  Search.configure({ driver: "custom" });
  expect(Search.engine()).toBe(engine);
});

test("empty query returns all within where", async () => {
  await searchable(makePost({ id: 1, title: "A", user_id: 9 })).searchable();
  await searchable(makePost({ id: 2, title: "B", user_id: 9 })).searchable();
  await searchable(makePost({ id: 3, title: "C", user_id: 8 })).searchable();

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }

  const rows = await new Builder(PostModel, "").where("user_id", 9).get();
  expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
});

test("AlgoliaEngine update and search via fetch mock", async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  Search.setFetch(async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/batch")) {
      return Response.json({ taskID: 1 });
    }
    if (url.includes("/query")) {
      return Response.json({
        hits: [{ objectID: "1", title: "Star Trek", __scout_key: "1" }],
      });
    }
    return Response.json({});
  });
  Search.configure({
    driver: "algolia",
    algolia: { id: "APP", secret: "KEY" },
  });

  const post = makePost({ id: 1, title: "Star Trek" });
  await searchable(post).searchable();
  expect(calls.some((c) => c.url.includes("/batch"))).toBe(true);

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }
  const hits = await new Builder(PostModel, "star").get();
  expect(hits[0]?.title).toBe("Star Trek");
});

test("MeilisearchEngine update and search via fetch mock", async () => {
  const calls: string[] = [];
  Search.setFetch(async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/indexes") && init?.method === "POST") {
      return Response.json({ uid: "posts" }, { status: 201 });
    }
    if (url.includes("/documents") && init?.method === "POST") {
      return Response.json({ taskUid: 1 });
    }
    if (url.includes("/search")) {
      return Response.json({
        hits: [{ id: "2", title: "Dune" }],
      });
    }
    return Response.json({});
  });
  Search.configure({
    driver: "meilisearch",
    meilisearch: { host: "http://meili.test", key: "master" },
  });

  await searchable(makePost({ id: 2, title: "Dune" })).searchable();
  expect(calls.some((c) => c.includes("/documents"))).toBe(true);

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }
  const hit = await new Builder(PostModel, "dune").first();
  expect(hit?.title).toBe("Dune");
  expect(hit?.id).toBe("2");
  expect(await new Builder(PostModel, "dune").keys()).toEqual(["2"]);
});

test("whereIn filters collection engine results", async () => {
  await searchable(makePost({ id: 1, title: "Alpha", user_id: 1 })).searchable();
  await searchable(makePost({ id: 2, title: "Beta", user_id: 2 })).searchable();
  await searchable(makePost({ id: 3, title: "Gamma", user_id: 3 })).searchable();

  class PostModel {
    static searchableAs() {
      return "posts";
    }
  }

  const rows = await new Builder(PostModel, "")
    .whereIn("user_id", [1, 3])
    .get();
  expect(rows.map((r) => r.id).sort()).toEqual([1, 3]);
});
