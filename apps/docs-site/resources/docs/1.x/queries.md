---
title: Query Builder
description: Build fluent SQL selects, inserts, updates, and deletes with DB.table and QueryBuilder.
---

# Query Builder

## Introduction

The query builder gives you a fluent interface for most SQL work. Start from `DB.table`, chain constraints, then run the query. Bindings are parameterized for you — do not interpolate user input into column names or raw SQL fragments.

```ts
import { DB } from "@bunyad/database";

const users = await DB.table("users").where("active", 1).orderBy("id").get();

for (const user of users) {
  console.log(user.name);
}
```

`get` returns a [`Collection`](/docs/1.x/collections) of plain row objects. Connection setup, migrations, and schema live on the [database](/docs/1.x/database) page. Model queries that hydrate model instances are covered under [ORM](/docs/1.x/orm).

Import `DB`, `QueryBuilder`, and related types from `@bunyad/database`.

## Running queries

### Retrieving all rows

```ts
const users = await DB.table("users").get();
```

### Retrieving a single row or column

```ts
const user = await DB.table("users").where("name", "Ada").first();

const required = await DB.table("users").where("name", "Ada").firstOrFail();

const email = await DB.table("users").where("name", "Ada").value("email");

const row = await DB.table("users").find(3);
```

`firstOrFail` and `findOrFail` throw `RecordNotFoundException` when no row matches. `sole` requires exactly one row and throws when the result is empty or has more than one row:

```ts
const only = await DB.table("users").where("email", "ada@example.com").sole();

const name = await DB.table("users")
  .where("id", 1)
  .soleValue("name");
```

`findOr` runs a callback when the id is missing:

```ts
const user = await DB.table("users").findOr(99, () => ({
  id: 99,
  name: "Guest",
}));
```

### Plucking columns

```ts
const titles = await DB.table("users").pluck("title");

const joined = await DB.table("users").implode("name", ", ");
```

### Checking existence

```ts
await DB.table("orders").where("user_id", 1).exists();
await DB.table("orders").where("user_id", 1).doesntExist();

await DB.table("orders").where("user_id", 1).existsOr(() => "none");
await DB.table("orders").where("user_id", 1).doesntExistOr(() => "found");
```

### Chunking results

Process large tables in pages. Return `false` from the callback to stop:

```ts
await DB.table("users")
  .orderBy("id")
  .chunk(100, async (users) => {
    for (const user of users) {
      // ...
    }
  });
```

`chunkMap` collects a mapped value per row. `each` walks rows one at a time (chunked under the hood):

```ts
const emails = await DB.table("users").orderBy("id").chunkMap(100, (row) =>
  String(row.email),
);

await DB.table("users").orderBy("id").each(async (user, index) => {
  // ...
}, 500);
```

`chunkById` / `chunkByIdDesc` and `eachById` page by a monotonic column so concurrent inserts do not skip rows:

```ts
await DB.table("users").chunkById(100, async (users) => {
  // ...
}, "id");

await DB.table("users").chunkByIdDesc(100, async (users) => {
  // ...
});
```

`forPageAfterId` and `forPageBeforeId` are lower-level keyset helpers:

```ts
await DB.table("users").forPageAfterId(50, lastId).get();
```

### Streaming with cursor and lazy

`cursor` and `lazy` are async generators that yield rows in chunks. `lazyById` / `lazyByIdDesc` use id-based paging:

```ts
for await (const user of DB.table("users").orderBy("id").cursor(200)) {
  // ...
}

for await (const user of DB.table("users").lazyById(200, "id")) {
  // ...
}
```

### Aggregates

```ts
await DB.table("orders").count();
await DB.table("orders").count("id");
await DB.table("orders").distinct().count("user_id");

await DB.table("orders").avg("price");
await DB.table("orders").average("price");
await DB.table("orders").sum("price");
await DB.table("orders").min("price");
await DB.table("orders").max("price");
```

Aggregates ignore the builder’s `limit` / `offset` / `orderBy` / `groupBy` for the aggregate query itself.

## Select statements

```ts
await DB.table("users").select("name", "email").get();

await DB.table("users").addSelect("phone").get();

await DB.table("users").distinct().select("status").get();
```

### Subquery selects and from

```ts
await DB.table("users")
  .select("users.*")
  .selectSub((q) => {
    q.from("orders").selectRaw("COUNT(*)").whereColumn("orders.user_id", "users.id");
  }, "orders_count")
  .get();

await DB.table("users")
  .fromSub((q) => {
    q.from("users").where("active", 1);
  }, "active_users")
  .get();
```

`from` replaces the table. Use it when you need a different base table on an existing builder.

## Raw expressions

Prefer bindings over string concatenation:

```ts
await DB.table("users")
  .selectRaw("COUNT(*) as user_count, status")
  .groupBy("status")
  .get();

await DB.table("orders")
  .whereRaw("price > IF(state = 'TX', ?, 100)", [200])
  .get();

await DB.table("users").orderByRaw("FIELD(status, 'new', 'active', 'closed')").get();
```

`orWhereRaw`, `groupByRaw`, `havingRaw`, and `orHavingRaw` follow the same pattern.

:::warning
Never put untrusted input into raw SQL. Bindings cover values, not identifiers.
:::

## Joins

```ts
await DB.table("users")
  .join("contacts", "users.id", "=", "contacts.user_id")
  .select("users.*", "contacts.phone")
  .get();

await DB.table("users")
  .leftJoin("posts", "users.id", "=", "posts.user_id")
  .get();

await DB.table("posts")
  .rightJoin("users", "users.id", "=", "posts.user_id")
  .get();

await DB.table("sizes").crossJoin("colors").get();
```

Advanced join conditions use a `JoinClause` callback (`on`, `orOn`, `where`, `orWhere`):

```ts
await DB.table("users")
  .join("contacts", (join) => {
    join
      .on("users.id", "=", "contacts.user_id")
      .orOn("users.email", "=", "contacts.email");
  })
  .get();
```

`joinWhere`, `leftJoinWhere`, and `rightJoinWhere` compare a column to a bound value in the join clause.

### Subquery joins

```ts
await DB.table("users")
  .joinSub(
    (q) => {
      q.from("orders").select("user_id").selectRaw("SUM(total) as total").groupBy("user_id");
    },
    "order_totals",
    "users.id",
    "=",
    "order_totals.user_id",
  )
  .get();
```

`leftJoinSub`, `rightJoinSub`, and `crossJoinSub` are available with the same shapes.

## Unions

```ts
const first = DB.table("users").whereNull("role");
const second = DB.table("users").where("role", "admin");

const rows = await first.union(second).orderBy("id").get();

await DB.table("users")
  .where("active", 1)
  .unionAll(DB.table("users").where("active", 1))
  .get();
```

## Basic where clauses

### Simple comparisons

Two arguments mean equality. Three arguments set the operator:

```ts
await DB.table("users").where("votes", 100).get();

await DB.table("users").where("votes", ">=", 100).get();
```

Chain more `where` calls for `AND`. Use `orWhere` for `OR`:

```ts
await DB.table("users")
  .where("votes", ">", 100)
  .orWhere("name", "Ada")
  .get();
```

### Nested groups

Pass a callback to group clauses. `whereNot` / `orWhereNot` wrap the group in `NOT`:

```ts
await DB.table("users")
  .where("active", 1)
  .where((q) => {
    q.where("votes", ">", 100).orWhere("title", "Admin");
  })
  .get();

await DB.table("users")
  .whereNot((q) => {
    q.where("status", "banned").orWhere("votes", "<", 0);
  })
  .get();
```

`whereNested` and `orWhereNested` are explicit aliases for nested groups.

### Where any / all / none

```ts
await DB.table("users")
  .whereAny(["name", "email", "title"], "like", "%Ada%")
  .get();

await DB.table("posts")
  .whereAll(["draft", "hidden"], "=", 0)
  .get();

await DB.table("users")
  .whereNone(["name", "email"], "like", "%spam%")
  .get();
```

`orWhereAny`, `orWhereAll`, and `orWhereNone` exist as well.

### Additional where helpers

```ts
await DB.table("users").whereNull("last_login").get();
await DB.table("users").whereNotNull("email_verified_at").get();

await DB.table("users").whereIn("id", [1, 2, 3]).get();
await DB.table("users").whereNotIn("id", [1, 2]).get();

await DB.table("users").whereIntegerInRaw("id", [1, 2, 3]).get();

await DB.table("users").whereBetween("votes", [1, 100]).get();
await DB.table("users").whereNotBetween("votes", [1, 100]).get();

await DB.table("users").whereColumn("updated_at", ">", "created_at").get();

await DB.table("users").whereLike("name", "%ada%").get();
await DB.table("users").whereNotLike("name", "%ada%", true).get();

await DB.table("users").whereUuid("uuid", "550e8400-e29b-41d4-a716-446655440000").get();
await DB.table("users").whereUlid("ulid", "01ARZ3NDEKTSV4RRFFQ69G5FAV").get();
```

`whereLike` uses `ILIKE` on Postgres when case-insensitive. Pass `true` as the third argument for a case-sensitive comparison where the driver supports it.

Every helper above has an `orWhere*` sibling where that pattern applies (`orWhereNull`, `orWhereIn`, `orWhereBetween`, `orWhereColumn`, `orWhereLike`, and so on).

### Date filters

`whereDate`, `whereYear`, `whereMonth`, and `whereDay` compare calendar parts. Values may be `Y-m-d` strings, `Date` instances, or duck-typed dayjs/luxon objects:

```ts
await DB.table("users").whereDate("created_at", "2026-01-15").get();
await DB.table("users").whereDate("created_at", ">", "2026-01-01").get();
await DB.table("users").whereYear("created_at", 2026).get();
await DB.table("users").whereMonth("created_at", 3).get();
await DB.table("users").whereDay("created_at", 15).get();
```

### JSON where clauses

Path syntax uses `->` (driver-specific SQL is generated for you):

```ts
await DB.table("users")
  .whereJsonContains("options->languages", "en")
  .get();

await DB.table("users").whereJsonDoesntContain("options->languages", "en").get();

await DB.table("users").whereJsonContainsKey("options->language").get();
await DB.table("users").whereJsonDoesntContainKey("options->language").get();

await DB.table("users").whereJsonLength("options->languages", 2).get();
await DB.table("users").whereJsonLength("options->languages", ">", 1).get();
```

### Full text

```ts
await DB.table("posts").whereFullText(["title", "body"], "bunyad").get();
await DB.table("posts").orWhereFullText("body", "query").get();
```

Driver support varies. On SQLite the builder falls back to `LIKE` patterns.

### Where exists

```ts
await DB.table("users")
  .whereExists((q) => {
    q.select("*")
      .from("orders")
      .whereColumn("orders.user_id", "users.id");
  })
  .get();
```

`orWhereExists`, `whereNotExists`, and `orWhereNotExists` are available.

## Ordering, grouping, limit, and offset

```ts
await DB.table("users").orderBy("name").get();
await DB.table("users").orderBy("name", "desc").get();
await DB.table("users").orderByDesc("created_at").get();

await DB.table("users").latest().get(); // created_at desc
await DB.table("users").oldest("updated_at").get();

await DB.table("users").inRandomOrder().first();

await DB.table("users").reorder("name").get();
await DB.table("users").reorderDesc("id").get();
```

```ts
await DB.table("orders")
  .select("user_id")
  .selectRaw("SUM(total) as total")
  .groupBy("user_id")
  .having("total", ">", 1000)
  .get();

await DB.table("orders")
  .groupBy("user_id")
  .havingBetween("total", [100, 500])
  .get();

await DB.table("users").havingNull("manager_id").groupBy("team_id").get();
```

`orHaving`, `havingNotBetween`, `havingNotNull`, and the matching `or*` forms are available.

```ts
await DB.table("users").offset(10).limit(5).get();
await DB.table("users").skip(10).take(5).get();
await DB.table("users").forPage(2, 15).get();
```

## Conditional clauses

```ts
await DB.table("users")
  .when(role, (q, value) => {
    q.where("role", value);
  })
  .get();

await DB.table("users")
  .unless(includeInactive, (q) => {
    q.where("active", 1);
  })
  .get();

await DB.table("users")
  .tap((q) => {
    q.orderBy("id");
  })
  .get();
```

`when` / `unless` accept an optional third callback for the opposite branch. `clone` copies the builder so you can branch without mutating the original.

## Inserts

```ts
await DB.table("users").insert({ email: "ada@example.com", votes: 0 });

await DB.table("users").insert([
  { email: "ada@example.com" },
  { email: "grace@example.com" },
]);

const id = await DB.table("users").insertGetId({ email: "ada@example.com" });

await DB.table("users").insertOrIgnore({ email: "ada@example.com" });
```

`insertOrIgnore` uses the driver’s ignore / `ON CONFLICT DO NOTHING` form when available.

### Upserts and update-or-insert

```ts
await DB.table("flights").upsert(
  [
    { departure: "Oakland", destination: "San Diego", price: 99 },
    { departure: "Chicago", destination: "New York", price: 150 },
  ],
  ["departure", "destination"],
  ["price"],
);

await DB.table("users").updateOrInsert(
  { email: "ada@example.com" },
  { name: "Ada", votes: 1 },
);

await DB.table("users").updateOrInsert({ email: "ada@example.com" }, (exists) =>
  exists ? { votes: 2 } : { name: "Ada", votes: 0 },
);
```

## Updates

```ts
await DB.table("users").where("id", 1).update({ votes: 1 });

await DB.table("users").where("id", 1).increment("votes");
await DB.table("users").where("id", 1).increment("votes", 5);
await DB.table("users").where("id", 1).decrement("votes", 2);

await DB.table("users").where("id", 1).incrementEach({
  votes: 1,
  points: 5,
});
await DB.table("users").where("id", 1).decrementEach({ votes: 1 });
```

## Deletes

```ts
await DB.table("users").where("votes", 0).delete();

await DB.table("users").truncate();
```

On SQLite, `truncate` runs `DELETE FROM …` instead of `TRUNCATE TABLE`.

## Pessimistic locking

```ts
await DB.transaction(async () => {
  const user = await DB.table("users").where("id", 1).lockForUpdate().first();
  // ...
});

await DB.table("users").where("id", 1).sharedLock().first();

await DB.table("users").where("id", 1).lock(true).first();
await DB.table("users").lock("FOR UPDATE NOWAIT").first();
await DB.table("users").lock(false).first();
```

SQLite does not emit lock clauses; the methods are no-ops in SQL for that driver.

## Casts on query results

Apply casts when hydrating rows from `get` / `first`:

```ts
const user = await DB.table("users")
  .where("id", 1)
  .withCasts({
    active: "boolean",
    meta: "json",
    score: "number",
  })
  .first();
```

Supported cast names: `boolean`, `number`, `string`, `json`, `date`, `datetime`, `array`.

## Debugging

```ts
const sql = DB.table("users").where("active", 1).toSql();
const bindings = DB.table("users").where("active", 1).getBindings();
const interpolated = DB.table("users").where("name", "Ada").toRawSql();
```

`toRawSql` is for debugging only. Prefer `toSql` + bindings in application code.

`DB.listen` registers a thin timing hook for queries on the connection:

```ts
const stop = DB.listen(({ sql, bindings, time }) => {
  console.log(sql, bindings, time);
});
// later
stop();
```

## Pagination

`paginate`, `simplePaginate`, and `cursorPaginate` live on the same builder. See [Pagination](/docs/1.x/pagination) for page detection, URL helpers, and JSON shape.

```ts
const page = await DB.table("users").orderBy("id").paginate(15);
```

## Named connections

```ts
await DB.connection("analytics").table("events").where("type", "click").get();
```

Raw statement helpers on `DB` (`select`, `selectOne`, `insert`, `update`, `delete`, `statement`, `unprepared`, `transaction`, …) are documented with [database](/docs/1.x/database) connections.
