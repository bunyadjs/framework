---
title: Pagination
description: Paginate query builder and model results with page, simple, and cursor paginators.
---

# Pagination

## Introduction

Pagination splits a large result set into pages. The query builder and model query both expose `paginate`, `simplePaginate`, and `cursorPaginate`. During an HTTP request the kernel binds the current request, so omitting the page argument reads `?page=` (or your custom page name) automatically.

```ts
import { DB } from "@bunyad/database";
import { Route } from "@bunyad/router";

Route.get("/users", async () => {
  return DB.table("users").orderBy("id").paginate(15);
});
```

Returning a paginator from a route serializes it with `toJSON()` (`data`, `links`, `meta`). For transformed API payloads, pass the paginator to a resource’s `paginate` helper (see below).

Paginator classes live in `@bunyad/database` (`LengthAwarePaginator`, `Paginator`, `CursorPaginator`, `AbstractPaginator`). ORM methods that return models are on `@bunyad/orm` — see [ORM](/docs/1.x/orm). Query constraints are covered in [Query Builder](/docs/1.x/queries).

## Paginating query builder results

`paginate` runs a count query, then selects one page with `limit` / `offset`. The default page size is `15`:

```ts
const users = await DB.table("users").orderBy("id").paginate(15);
```

You get a `LengthAwarePaginator` with `items`, `total`, `perPage`, `currentPage`, and helpers such as `lastPage()`, `from()`, `to()`, `hasMorePages()`, `links()`, and `meta()`.

### Full argument list

```ts
await DB.table("users").paginate(
  15,
  ["id", "name"],
  "page",
  2,
);
```

Arguments are `perPage`, `columns`, `pageName`, and `page`. When `page` is omitted, the builder reads the named query parameter from the bound request (default `page`).

### Alternate overload

An older overload still works: `paginate(perPage, page, options)` where `options` may include `path` and `columns`:

```ts
await DB.table("users").paginate(15, 2, { path: "/users" });
```

Prefer the four-argument form when you need a custom page name or column list.

## Simple pagination

When you only need next / previous links, skip the count with `simplePaginate`. It fetches `perPage + 1` rows to detect another page:

```ts
const users = await DB.table("users").orderBy("id").simplePaginate(15);
```

The result is a `Paginator`. Use `pageItems()` for the current page (it drops the lookahead row). `hasMorePages()`, `links()`, and `toJSON()` are available.

The same dual signatures as `paginate` apply (`perPage, columns, pageName, page` or `perPage, page, options`).

## Paginating model results

Models and model queries paginate the same way, but hydrate model instances and can eager-load relations:

```ts
import User from "@/Models/User.ts";

const users = await User.paginate(15);

const filtered = await User.where("votes", ">", 100).paginate(15);

const simple = await User.where("active", 1).simplePaginate(15);

const cursor = await User.orderBy("id").cursorPaginate(15);
```

Static `Model.paginate` and `Model.cursorPaginate` use `(perPage, page?, options?)` and `(perPage, cursor?, options?)` respectively. Chain `where` / `orderBy` / `with` on the query for constrained pages:

```ts
const page = await User.with("posts")
  .where("active", 1)
  .orderBy("id")
  .paginate(15, undefined, { path: "/users", pageName: "page" });
```

## Multiple paginators on one screen

Give each paginator its own page query name so they do not share `?page=`:

```ts
const users = await DB.table("users").paginate(15, ["*"], "users");
const posts = await DB.table("posts").paginate(15, ["*"], "posts");
```

On model queries, pass `pageName` in options:

```ts
await User.paginate(15, undefined, { pageName: "users" });
```

## Cursor pagination

Cursor pagination uses `WHERE` constraints on the ordered columns instead of `OFFSET`. It suits large tables and infinite-scroll UIs. Links carry an opaque `cursor` string, not a page number:

```ts
const page = await DB.table("users").orderBy("id").cursorPaginate(15);

const next = await DB.table("users")
  .orderBy("id")
  .cursorPaginate(15, page.nextCursor());
```

Rules:

- Provide at least one column `orderBy` (not only `orderByRaw`). If you omit orders, the builder defaults to `orderBy("id", "asc")`.
- Order columns should be unique (or a unique combination). Prefer indexed columns.
- Pass the cursor string yourself. Unlike `page`, the builder does not read `?cursor=` from the request automatically — take it from `request.input("cursor")` when needed.

```ts
import type { Request } from "@bunyad/http";

async function index(request: Request) {
  const cursor = request.input("cursor");
  return DB.table("users")
    .orderBy("id")
    .cursorPaginate(
      15,
      ["*"],
      "cursor",
      typeof cursor === "string" ? cursor : null,
    );
}
```

`CursorPaginator` exposes `items`, `perPage`, `nextCursor()`, `previousCursor()`, `hasMorePages()`, `onFirstPage()`, and `toJSON()` with `next_page_url` / `prev_page_url` when a path is known.

## Creating a paginator manually

Build a paginator from an in-memory slice when the data is not coming from the query builder:

```ts
import {
  LengthAwarePaginator,
  Paginator,
  CursorPaginator,
} from "@bunyad/database";

const lengthAware = new LengthAwarePaginator(items, total, perPage, currentPage, {
  path: "/users",
  pageName: "page",
});

const simple = new Paginator(itemsPlusLookahead, perPage, currentPage, {
  path: "/users",
});

const cursor = new CursorPaginator(items, perPage, {
  path: "/users",
  cursorName: "cursor",
  nextCursor: "…",
  previousCursor: null,
});
```

You must slice `items` yourself for length-aware and cursor pages. For `Paginator`, pass up to `perPage + 1` rows so `hasMorePages()` / `pageItems()` work.

## Customizing pagination URLs

By default, link paths come from the current request (`urlWithoutQuery()`), or from a resolver you register. Override the path per instance:

```ts
const users = await DB.table("users").paginate(15);
users.withPath("/admin/users");
```

Or pass `path` when constructing / paginating:

```ts
await DB.table("users").paginate(15, 1, { path: "/admin/users" });
```

### Appending query string values

```ts
users.appends("sort", "votes");
users.appends({ filter: "active", q: "ada" });
users.withQueryString();
```

`withQueryString` copies the current request query except the page parameter. `appends` skips the page name and null values.

`url(page)` builds a single page URL, or returns `null` when no path is set.

### Resolvers

For non-HTTP contexts, or to override defaults globally:

```ts
import { AbstractPaginator } from "@bunyad/database";

AbstractPaginator.currentPathResolver(() => "/users");
AbstractPaginator.currentPageResolver((pageName) => {
  // return the current page for pageName
  return 1;
});
AbstractPaginator.queryStringResolver(() => ({ sort: "name" }));
```

Pass `null` to clear a resolver. Framework HTTP requests already bind path, page, and query through `runWithPaginatorRequest` inside the kernel — you normally do not call that helper in app code.

`resolvePaginatorPage(page?, pageName?)` returns an explicit page, or the request / resolver value, defaulting to `1`.

## JSON responses

`LengthAwarePaginator.toJSON()`:

```json
{
  "data": [/* items */],
  "links": {
    "first": "/users?page=1",
    "last": "/users?page=4",
    "prev": null,
    "next": "/users?page=2"
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 4,
    "path": "/users",
    "per_page": 15,
    "to": 15,
    "total": 50
  }
}
```

`Paginator.toJSON()` uses `pageItems()` for `data` and a smaller `meta` (`current_page`, `per_page`, `path`). Its `links` include `first`, `prev`, and `next` (no `last`).

`CursorPaginator.toJSON()` returns `data`, `path`, `per_page`, `next_cursor`, `prev_cursor`, and matching page URLs.

Pass an alternate `data` array into `toJSON(data)` when a resource layer has already mapped the rows.

### API resources

```ts
import User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

const page = await User.orderBy("id").paginate(15);
return UserResource.paginate(page);
```

`JsonResource.paginate` maps each item through the resource and keeps the paginator’s `links` and `meta`.

## Instance methods

### LengthAwarePaginator

| Method / property | Role |
| --- | --- |
| `items` | Current page rows |
| `total` | Total matching rows |
| `perPage` | Page size |
| `currentPage` | Current page (1-based) |
| `lastPage()` | Last page number |
| `from()` / `to()` | 1-based indexes of the first / last item on this page, or `null` |
| `hasMorePages()` | Whether a next page exists |
| `links()` | `first` / `last` / `prev` / `next` URLs |
| `meta()` | Meta object used by `toJSON` |
| `withPath` / `appends` / `withQueryString` / `url` | URL helpers |

### Paginator (simple)

| Method / property | Role |
| --- | --- |
| `items` | Fetched rows including optional lookahead |
| `pageItems()` | Rows for the current page only |
| `perPage` / `currentPage` | Size and page |
| `hasMorePages()` | True when a lookahead row was present |
| `links()` | `first` / `prev` / `next` |
| `withPath` / `appends` / `withQueryString` / `url` | URL helpers |

### CursorPaginator

| Method / property | Role |
| --- | --- |
| `items` | Current window of rows |
| `perPage` | Page size |
| `nextCursor()` / `previousCursor()` | Opaque cursor strings or `null` |
| `hasMorePages()` | Whether `nextCursor` is set |
| `onFirstPage()` | Whether `previousCursor` is null |
| `toJSON()` | Cursor JSON payload |

`encodeCursor` / `decodeCursor` are exported for advanced use when you need to inspect cursor payloads.

## Displaying results in views

Loop `paginator.items` (or `pageItems()` for simple pagination) in your template. Build next / previous controls from `links()` or the cursor helpers. The framework does not ship HTML pagination partials — render the URLs yourself, or return JSON to a SPA.
