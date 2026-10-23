---
title: ORM
description: Define models, query rows, and persist creates, updates, and deletes with @bunyad/orm.
---

# ORM

## Introduction

Each database table has a model class that reads and writes that table. Models live in `app/Models`, extend `Model` from `@bunyad/orm`, and give you a fluent query API plus instance methods for save, update, and delete.

```ts title="app/Models/Flight.ts"
import { Model } from "@bunyad/orm";

export default class Flight extends Model {
  declare name: string;

  static table = "flights";
  static fillable = ["name"] as const;
}
```

```ts
import Flight from "@/Models/Flight.ts";

const flights = await Flight.where("active", 1).orderBy("name").get();
const flight = await Flight.find(1);
```

Configure a connection in `config/database.ts` before you query. The default connection is what every model uses unless you override it.

To use `@bunyad/orm` in a plain Bun script or another package — without booting the framework — see [using packages alone](/docs/1.x/standalone#orm) and the section below.

For NestJS, Next.js, Express, and Bun servers without a full app, see [using the ORM outside Bunyad](/docs/1.x/orm-outside).

Related chapters (when published): [relationships](/docs/1.x/orm-relationships), [collections](/docs/1.x/orm-collections), [mutators and casting](/docs/1.x/orm-mutators), [API resources](/docs/1.x/orm-resources), [serialization](/docs/1.x/orm-serialization), and [factories](/docs/1.x/orm-factories).

## Using the ORM alone

Install `@bunyad/orm` and `@bunyad/database`, open a connection, and call `Model.setConnection` once. Models then work the same as in an app:

```ts
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "@bunyad/orm";

const connection = connectSqlite(":memory:");
Model.setConnection(connection);

await schemaFor(connection).create("flights", (table) => {
  table.id();
  table.string("name");
  table.timestamps();
});

class Flight extends Model {
  declare name: string;
  static table = "flights";
  static fillable = ["name"] as const;
}

await Flight.create({ name: "London to Paris" });
const flights = await Flight.where("name", "like", "%Paris%").get();
```

No service providers or `config/database.ts` are required. A longer example with relations lives on [using packages alone](/docs/1.x/standalone#orm).

## Generating model classes

`bunyad make:model` writes a stub under `app/Models`. `--force` overwrites an existing file.

```shell
bunyad make:model Flight
bunyad make:model Flight --force
```

The stub sets `static table` to a plural snake_case guess (`Flight` → `flights`) and a starter `fillable` list. Adjust both to match your schema.

## Model conventions

### Table names

Set `static table` on every model. The ORM does not infer the table from the class name at runtime.

```ts
export default class Flight extends Model {
  static table = "my_flights";
}
```

### Primary keys

The default primary key is `id`, an incrementing integer. Change the column with `static primaryKey`. For string or assigned keys, turn off incrementing and set the key type:

```ts
export default class Flight extends Model {
  static table = "flights";
  static primaryKey = "flight_id";
  static incrementing = false;
  static keyType = "string";
}
```

`exists` on an instance is `true` after a retrieve or a successful insert. It is not inferred from the primary key alone, so assigned UUIDs work before the first save.

### UUID and ULID keys

Decorators from `@bunyad/orm` assign ordered ids on create:

```ts
import { HasUlids, HasUuids, Model } from "@bunyad/orm";

@HasUuids()
export default class Article extends Model {
  static table = "articles";
}

@HasUlids()
export default class Order extends Model {
  static table = "orders";
}
```

Both set `incrementing = false` and `keyType = "string"`. Helpers `uuid7()` and `ulid()` are available when you need to generate values yourself. Query helpers `whereUuid` / `whereUlid` exist on model queries.

### Timestamps

With `static timestamps = true` (the default), `save` and `create` maintain `created_at` and `updated_at`. `save` only bumps `updated_at` when the model has changes (and you did not set `updated_at` yourself), so saving an unchanged model issues no `UPDATE`. Set `timestamps = false` to skip them. Run a block without touching timestamps:

```ts
await Flight.withoutTimestamps(async () => {
  const flight = await Flight.find(1);
  flight!.name = "Renamed";
  await flight!.save();
});
```

### Database connections

`static connection` pins a model to a named connection from your database config. `Model.on("secondary")` starts a query on that connection for one call. An instance can override with `setConnection`.

```ts
export default class Flight extends Model {
  static table = "flights";
  static connection = "pgsql";
}

await Flight.on("sqlite").where("active", 1).get();
```

### Attribute declarations and casts

Declare column types on the class for TypeScript. Cast maps turn storage values into the types you use in code:

```ts
export default class User extends Model {
  declare name: string;
  declare email: string;
  declare is_admin: boolean;
  declare meta: Record<string, unknown> | null;

  static table = "users";
  static fillable = ["name", "email", "is_admin", "meta"] as const;

  static casts() {
    return {
      is_admin: "boolean",
      meta: "json",
    } as const;
  }
}
```

Built-in cast names include `boolean`, `number` / `integer`, `float`, `decimal`, `bigint`, `string`, `json`, `array`, `collection`, `date`, `datetime`, `encrypted`, and `hashed`. You can also use enum objects and `Attribute.make({ get, set })`. See [mutators and casting](/docs/1.x/orm-mutators) for the full surface.

`static hidden` drops keys from `toArray()` / `toJson()`. `static appends` adds accessors when serializing. Details live under [serialization](/docs/1.x/orm-serialization).

### Strictness

Opt into stricter behavior for local development:

```ts
import { Model } from "@bunyad/orm";

Model.shouldBeStrict(true);
// or individually:
Model.preventLazyLoading(true);
Model.preventSilentlyDiscardingAttributes(true);
Model.preventAccessingMissingAttributes(true);
```

Lazy loads outside an eager `with()` throw `LazyLoadingViolationException`. Mass assignment of non-fillable keys throws `MassAssignmentException` when silent discard is prevented. Reading an attribute that was never selected throws `MissingAttributeException`.

## Retrieving models

Start from the model class. Static `where`, `orderBy`, `limit`, and friends return a `ModelQuery`. Call `get()` to hydrate an `OrmCollection` of models.

```ts
import Flight from "@/Models/Flight.ts";

const flights = await Flight.all();

const active = await Flight.where("active", 1)
  .orderBy("name")
  .get();

const first = await Flight.where("active", 1).first();
```

`query()` and `newQuery()` return the same scoped builder. Prefer the static starters for short chains.

```ts
const q = Flight.query().where("destination", "Paris").limit(10);
await q.get();
```

Common constraints mirror the query builder: `where`, `orWhere`, `whereIn`, `whereNull`, `whereBetween`, `whereColumn`, `whereRaw`, `whereLike`, `whereDate` / `whereYear` / `whereMonth` / `whereDay`, `when`, `search(columns, term)`, joins, `select` / `addSelect` / `selectRaw`, `groupBy`, `having`, and ordering helpers including `orderByDesc`, `orderByRaw`, `inRandomOrder`, and `reorder`.

Inspect SQL without running it:

```ts
Flight.where("name", "shah").toSql();
Flight.where("name", "shah").getBindings();
```

### Collections

`get()` and `all()` return an `OrmCollection` — a collection of models with ORM helpers such as `load`, `loadCount`, and aggregate loaders. Plain list helpers (`map`, `filter`, `pluck`) come from the shared collection type. See [ORM collections](/docs/1.x/orm-collections) and [Collections](/docs/1.x/collections).

### Chunking and lazy iteration

Process large result sets in batches:

```ts
await Flight.where("active", 1).chunk(200, async (flights) => {
  for (const flight of flights) {
    // ...
  }
});

await Flight.query().chunkById(200, async (flights) => {
  // ordered by primary key
});

for await (const flight of Flight.query().lazy(200)) {
  // one model at a time, fetched in chunks
}

for await (const flight of Flight.query().lazyById(200)) {
  // ...
}
```

### Pagination

```ts
const page = await Flight.where("active", 1).paginate(15);
// page.items(), page.total(), page.currentPage(), …

const simple = await Flight.query().simplePaginate(15);
const cursor = await Flight.query().orderBy("id").cursorPaginate(15);
```

Static `Flight.paginate(15)` and `Flight.cursorPaginate(15)` forward to a new query.

### Eager loading

Load relations in one round trip. Define relations on `static relations` (or instance methods) and pass names to `with`:

```ts
const users = await User.with("posts", "profile").get();

const user = await User.query()
  .with({ posts: true })
  .where("id", 1)
  .first();
```

After load, read the related models on the instance. Use `related("posts")` when you need the relation query. Full patterns are in [relationships](/docs/1.x/orm-relationships).

### SQLite sync helpers

On SQLite, sync variants skip the microtask queue when no model event listeners are registered: `getSync`, `firstSync`, `findSync`, `allSync`. They do not run `with()` eager loads or `retrieved` listeners.

```ts
const flight = Flight.findSync(1);
const all = Flight.allSync();
```

### Query builder methods on the model

Builder methods can be called straight on the model class, so `User.whereBetween("age", [18, 30])` is the same as `User.query().whereBetween(...)`. This includes the where family (`whereNotIn`, `whereRaw`, `whereColumn`, `whereLike`, `orWhereIn`, …), `has` / `doesntHave` and the morph variants, `groupBy` / `having` / `selectRaw`, `offset`, `when` / `unless`, `inRandomOrder`, `lockForUpdate`, and the finders and terminals `firstWhere`, `findMany`, `chunkById`, `count`, `sum`, `max`, `exists`, `toSql`.

### Query builder reference

Every example below is covered by a test that runs on SQLite, Postgres and MySQL.

**Negation and grouped columns**

```ts
await User.whereNot("status", "banned").get();
await User.whereNot("age", ">", 35).get();
await User.whereNot((q) => q.where("status", "banned").where("age", ">", 45)).get();
await User.where("age", "<", 25).orWhereNot("status", "active").get();

// Match any / all / none of several columns
await User.query().whereAny(["name", "email"], "like", "%@example.com").get();
await User.query().whereAll(["name", "status"], "like", "%a%").get();
await User.query().whereNone(["name", "status"], "like", "%o%").get();
```

**`orWhere` variants**

`orWhereIn`, `orWhereNotIn`, `orWhereNull`, `orWhereNotNull`, `orWhereBetween`, `orWhereNotBetween`, `orWhereLike`, `orWhereNotLike`, `orWhereColumn` and `orWhereRaw` take the same arguments as their `where` counterparts:

```ts
await User.where("name", "ann").orWhereNull("email").get();
await User.where("name", "zzz").orWhereBetween("age", [25, 45]).get();
```

**Keys, paging and shaping**

```ts
await User.query().whereKey([1, 2]).get();
await User.query().whereKeyNot(1).get();
await User.query().orderBy("id").take(10).get();        // alias of limit
await User.query().orderBy("id").forPage(2, 15).get();  // page 2, 15 per page
await User.query().select("status").distinct().rows().get();
await User.query().tap((q) => audit(q)).get();          // run a callback, keep chaining
await User.where("name", "nobody").firstOr(() => User.firstOrFail());
```

**Joins and locks**

`join`, `leftJoin` and `rightJoin` take `(table, first, operator, second)`. `lockForUpdate()` and `sharedLock()` add a row lock inside a transaction. `toSql()` returns the SQL with `?` placeholders; `toRawSql()` inlines the bindings (for debugging only).

**Subqueries, unions and joins on subqueries**

A subquery can be a closure that configures a query builder, a query builder, or another model query:

```ts
// A correlated subquery as a column
await User.query()
  .select("users.*")
  .selectSub(
    Post.query().selectRaw("COUNT(*)").whereColumn("posts.user_id", "users.id"),
    "post_count",
  )
  .get();

// EXISTS / NOT EXISTS (and orWhereExists, orWhereNotExists)
await User.query()
  .whereExists(Post.query().whereColumn("posts.user_id", "users.id").where("views", ">", 100))
  .get();

// UNION / UNION ALL: both sides must select the same columns
await User.query().select("name").where("age", "<", 25)
  .union(User.query().select("name").where("age", ">", 65))
  .get();

// Join against an aggregate subquery (joinSub, leftJoinSub, rightJoinSub)
const totals = Post.query().select("user_id").selectRaw("SUM(views) AS total").groupBy("user_id");
await User.query()
  .select("users.name", "t.total")
  .leftJoinSub(totals, "t", "t.user_id", "=", "users.id")
  .rows()
  .get();
```

`crossJoin(table)` and `groupByRaw(sql, bindings)` are available too. Like `selectRaw`, columns that come from a subquery are not model attributes; use `.rows()` to read them as plain objects.

**Hidden attributes**

```ts
user.makeVisible("secret");        // show a hidden attribute for this instance
user.makeHidden("secret", "email");
user.setHidden(["name"]);          // replace the hidden list
user.getHidden();
```

## Retrieving single models and aggregates

```ts
const flight = await Flight.find(1);
const flightOrFail = await Flight.findOrFail(1);

const many = await Flight.query().findMany([1, 2, 3]);
const orNew = await Flight.query().findOrNew(99);
const orCallback = await Flight.query().findOr(1, () => new Flight({ name: "Fallback" }));

const first = await Flight.query().firstWhere("name", "Cairo");
const sole = await Flight.where("code", "CA123").sole();
```

Missing `findOrFail` / `firstOrFail` / `sole` throw `ModelNotFoundException`.

Aggregates:

```ts
await Flight.where("active", 1).count();
await Flight.query().sum("price");
await Flight.query().avg("price");
await Flight.query().min("price");
await Flight.query().max("price");
await Flight.query().value("name");
await Flight.query().pluck("name");
await Flight.query().exists();
await Flight.query().doesntExist();
```

### Retrieving or creating

```ts
const flight = await Flight.firstOrCreate(
  { name: "London to Paris" },
  { delayed: false },
);

const pending = await Flight.firstOrNew({ name: "London to Paris" });
// not saved until you call save()

const updated = await Flight.updateOrCreate(
  { name: "London to Paris" },
  { delayed: true },
);
```

## Inserting and updating models

### Inserts

```ts
const flight = await Flight.create({
  name: "London to Paris",
});

const draft = new Flight();
draft.name = "Paris to London";
await draft.save();

const filled = new Flight();
filled.fill({ name: "Cairo Express" });
await filled.save();
```

`create` and `fill` respect `fillable` / `guarded`. After a successful insert, `wasRecentlyCreated()` is `true` on that instance.

Bulk insert (no creating/created events per row):

```ts
await Flight.insert([
  { name: "A" },
  { name: "B" },
]);
```

Timestamps are stamped when `timestamps` is enabled.

### Updates

```ts
const flight = await Flight.find(1);
flight!.name = "New name";
await flight!.save();

await flight!.update({ delayed: true });

await Flight.where("active", 1).update({ delayed: false });
```

Dirty tracking:

```ts
flight!.isDirty(); // any attribute
flight!.isDirty("name");
flight!.isClean("name");
flight!.getDirty();
flight!.getOriginal("name");
flight!.getChanges(); // after the last save
flight!.getPrevious(); // original values of the attributes changed by the last save
flight!.wasChanged("name");
```

`json`, `array`, `object` and `collection` attributes are compared by content, so editing one in place makes the model dirty and the edit is saved, while assigning an identical value is not a change. Dates compare by instant. `getOriginal()` and `getPrevious()` return the pristine value, not the object you edited. (`encrypted:*` attributes are still compared by reference: reassign them after editing.)

```ts
flight.options.theme = "dark"; // edited in place
flight.isDirty("options");     // true
flight.getOriginal("options"); // { theme: "light" } — the pristine value
await flight.save();
```

Inside `updated` and `saved` listeners the save is still visible through `isDirty()` and `getOriginal()`, and `wasChanged()` / `getChanges()` / `getPrevious()` are already set. The original values are synced after `saved`.

`refresh()` reloads from the database. `refreshForUpdate()` locks the row where the driver supports it. `fresh()` returns a new instance for the same key.

```ts
await flight!.increment("seats");
await flight!.decrement("seats", 2);
```

`touch()` updates `updated_at`. `static touches` lists relation names whose parents should be touched after save or soft delete. Wrap work in `Model.withoutTouching` when you need to skip that cascade.

### Mass assignment

`static fillable` is an allow-list for `create`, `fill`, and `update`. Prefer it in application models.

```ts
export default class Flight extends Model {
  static table = "flights";
  static fillable = ["name", "delayed"] as const;
}
```

`static guarded` lists blocked keys. The class default is `guarded = ["*"]` with an empty `fillable`, which Bunyad treats as **allow all** so generated stubs are usable immediately. Set `fillable` (or a real `guarded` list without `*`) before accepting request input.

With `preventSilentlyDiscardingAttributes(true)`, discarded keys throw `MassAssignmentException`.

### Upserts

```ts
await Flight.upsert(
  [
    { departure: "Oakland", destination: "San Diego", price: 99 },
    { departure: "Chicago", destination: "New York", price: 150 },
  ],
  ["departure", "destination"],
  ["price"],
);
```

Unique columns are the second argument. The third lists columns to update on conflict. Timestamps are maintained when enabled.

Bypass the guard when you really need to:

```ts
flight.forceFill({ name: "Cairo Express", status: "internal" }); // ignores fillable / guarded
await Flight.forceCreate({ name: "Seed", status: "internal" });

flight.isFillable("name");  // true
flight.isGuarded("status"); // true

// For seeders and imports: turn protection off globally, or only inside a callback.
Flight.unguard();
Flight.reguard();
await Flight.unguarded(async () => {
  await Flight.create({ name: "Imported", status: "internal" });
});
```

Attributes you assign directly (`flight.status = "x"; await flight.save()`) are always saved. A fillable column you leave unset is left out of the `INSERT`, so the database default applies.

## Deleting models

```ts
const flight = await Flight.find(1);
await flight!.delete();

await Flight.destroy([1, 2, 3]);
await Flight.where("active", 0).delete();
```

`deleteQuietly()` / `saveQuietly()` skip model events for that operation.

### Soft deleting

Mark a model with `@SoftDeletes()` (or `static softDeletes = true`). Deletes set `deleted_at` instead of removing the row. Queries exclude soft-deleted rows by default.

```ts
import { Model, SoftDeletes } from "@bunyad/orm";

@SoftDeletes()
export default class Flight extends Model {
  static table = "flights";
  static fillable = ["name"] as const;
}

await flight.delete(); // soft
await flight.restore();
await flight.forceDelete(); // hard

await Flight.withTrashed().get();
await Flight.onlyTrashed().get();
await Flight.withoutTrashed().get();

await Flight.forceDestroy([1, 2]);
```

Customize the column with `@SoftDeletes("archived_at")` or `static deletedAt`.

#### Cascading soft deletes

Soft deletes do not cascade on their own. Delete the children in a `deleting` listener, and restore them in `restored` if you want the reverse:

```ts
static booted() {
  this.deleting(async (team) => {
    for (const project of (await team.related("projects").get()).all()) {
      await project.delete();
    }
  });
}
```

Restoring the parent does not restore its children unless you add the matching `restored` listener.

### Pruning models

Decorate models that should be purged on a schedule:

```ts
import { Model, Prunable, SoftDeletes } from "@bunyad/orm";

@SoftDeletes()
@Prunable()
export default class Flight extends Model {
  static table = "flights";

  static prunable() {
    return this.where("created_at", "<", "2020-01-01");
  }
}
```

`@MassPrunable()` deletes with a query (no per-model events). Run:

```shell
bunyad model:prune
bunyad model:prune --model=Flight
bunyad model:prune --chunk=500
```

Or call `prune(Flight)` / `pruneAll()` from `@bunyad/orm`. Soft-deleted prunable models are force-deleted.

## Replicating models

```ts
const copy = flight!.replicate();
const copyWithout = flight!.replicate(["notes"]);
copy.name = "Copy";
await copy.save();
```

Primary key and timestamp columns are omitted. A `replicating` event fires on the copy.

## Query scopes

### Global scopes

Register a named scope that every query applies until removed:

```ts
Flight.addGlobalScope("ancient", (query) => {
  query.where("created_at", "<", "2000-01-01");
});

await Flight.withoutGlobalScope("ancient").get();
await Flight.withoutGlobalScopes().get();
Flight.removeGlobalScope("ancient");
```

#### Example: scoping rows to a tenant

A global scope plus a `creating` listener is enough to keep each tenant's rows apart. The scope limits every read, bulk update and delete; the listener stamps new rows:

```ts
let currentTenant: number | null = null; // set per request

class Project extends Model {
  static booted() {
    Project.addGlobalScope("tenant", (query) => {
      if (currentTenant !== null) query.where("projects.tenant_id", currentTenant);
    });
    Project.creating((project) => {
      if (currentTenant !== null && project.tenant_id === undefined) {
        project.tenant_id = currentTenant;
      }
    });
  }
}

await Project.find(idOfAnotherTenant);       // null
await Project.withoutGlobalScopes().count(); // every tenant, for admin tools
```

The scope also applies through relations, `has` / `whereHas` and aggregates. Qualify the column with the table name so joins stay unambiguous.

### Local scopes

Define `static scopeName(query, ...args)` on the model. Call it as `Name(...args)` on a query or as a static starter:

```ts
import { Model, type ModelQuery } from "@bunyad/orm";

export default class Flight extends Model {
  static table = "flights";

  static scopeActive(query: ModelQuery) {
    query.where("active", 1);
  }

  static scopeOfType(query: ModelQuery, type: string) {
    query.where("type", type);
  }
}

await Flight.active().orderBy("name").get();
await Flight.query().active().ofType("domestic").get();
```

### Pending attributes

`withAttributes` merges values into later `create()` calls and, by default, adds matching `where` clauses:

```ts
await Flight.query()
  .withAttributes({ airline: "BA" })
  .create({ name: "BA001" });

await Flight.query()
  .withAttributes({ hidden: 1 }, false) // attrs only, no wheres
  .create({ name: "Secret" });
```

## Events

Models fire lifecycle hooks so you can run code around retrieve, create, update, delete, soft-delete, and replicate. The events are:

| Event | When it runs |
| --- | --- |
| `retrieved` | An existing row is hydrated from the database |
| `creating` / `created` | Before / after the first insert |
| `updating` / `updated` | Before / after an update of an existing model |
| `saving` / `saved` | Before / after any `save()` (create or update) |
| `deleting` / `deleted` | Before / after a delete |
| `trashed` | After a soft delete |
| `forceDeleting` / `forceDeleted` | Before / after a permanent delete |
| `restoring` / `restored` | Before / after restoring a soft-deleted model |
| `replicating` | When `replicate()` builds a copy |

Order: create: `saving`, `creating`, `created`, `saved`. Update: `saving`, `updating`, `updated`, `saved`. Soft delete: `deleting`, `trashed`, `deleted`. Force delete: `forceDeleting`, `deleting`, `deleted`, `forceDeleted`. Restore: `restoring`, `restored`. `created_at` / `updated_at` are set after `creating` / `updating`, and `updated` fires only when something was written, so saving an unchanged model fires `saving` and `updating` but not `updated`.

Listeners and observers for one event run in registration order. Returning `false` from a before-event stops the remaining listeners and cancels the write; returning `false` from an after-event is ignored. An exception thrown by a listener aborts the operation and propagates to the caller, rolling back the surrounding transaction if there is one.

Events ending in `-ing` run before the change is persisted. Events ending in `-ed` run after. Return `false` from a before-event (`creating`, `saving`, `updating`, `deleting`, …) to cancel the operation.

Mass `update()`, `delete()`, `insert()`, and `upsert()` on the query builder do **not** fire these events — the models are never loaded. Prefer instance `save()` / `delete()` when listeners must run.

### Boot and booted

`static boot()` and `static booted()` run **once** per model class, the first time the class is queried, saved, or you register an event listener. Prefer registering listeners in `booted()`:

```ts title="app/Models/Flight.ts"
import { Model } from "@bunyad/orm";

export default class Flight extends Model {
  static table = "flights";
  static fillable = ["name"] as const;
  declare name: string;

  static boot() {
    // One-time setup for the class (scopes, etc.)
  }

  static booted() {
    this.creating((flight) => {
      if (!flight.name) {
        return false; // cancel the insert
      }
    });

    this.created((flight) => {
      // row is in the database; flight.id is set
    });

    this.saving((flight) => {
      // runs on create and update
    });

    this.saved((flight) => {
      // ...
    });

    this.updating((flight) => {
      // ...
    });

    this.updated((flight) => {
      // ...
    });

    this.deleting((flight) => {
      // ...
    });

    this.deleted((flight) => {
      // ...
    });

    this.retrieved((flight) => {
      // find / get / first hydrate
    });
  }
}
```

### Using closures

You can also register listeners with the static helpers on the model class — outside `booted`, or from a service provider:

```ts
import Flight from "@/Models/Flight.ts";

Flight.creating((flight) => {
  // ...
});

Flight.created((flight) => {
  // ...
});

Flight.updating((flight) => {
  // ...
});

Flight.updated((flight) => {
  // ...
});

Flight.saving((flight) => {
  // ...
});

Flight.saved((flight) => {
  // ...
});

Flight.deleting((flight) => {
  // ...
});

Flight.deleted((flight) => {
  // ...
});

Flight.retrieved((flight) => {
  // ...
});

Flight.trashed((flight) => {
  // soft delete finished
});

Flight.restoring((flight) => {
  // ...
});

Flight.restored((flight) => {
  // ...
});

Flight.forceDeleting((flight) => {
  // ...
});

Flight.forceDeleted((flight) => {
  // ...
});

Flight.replicating((flight) => {
  // ...
});
```

Listeners may be `async`. Before-events still cancel when they return `false` (or a Promise that resolves to `false`).

### Observers

When you listen for many events on one model, group the handlers in an observer class. Method names match the event names. Register with `Model.observe(...)` — pass a class, an instance, or an array:

```ts title="app/Observers/FlightObserver.ts"
import type Flight from "@/Models/Flight.ts";

export default class FlightObserver {
  creating(flight: Flight) {
    // ...
  }

  created(flight: Flight) {
    // ...
  }

  updated(flight: Flight) {
    // ...
  }

  deleted(flight: Flight) {
    // ...
  }
}
```

```ts
import Flight from "@/Models/Flight.ts";
import FlightObserver from "@/Observers/FlightObserver.ts";

Flight.observe(FlightObserver);
```

Set `afterCommit = true` on an observer to dispatch its after-events (`created`, `updated`, `saved`, `deleted`, …) once the outermost database transaction commits. Outside a transaction they run immediately, and inside one they are dropped if it rolls back. Before-events (`creating`, `saving`, …) always run in place:

```ts
export default class OrderObserver {
  afterCommit = true;

  created(order: Order) {
    // runs only if the surrounding transaction commits
  }
}
```

Call `observe` from a provider `boot()` method, or from the model’s own `booted()`:

```ts
static booted() {
  this.observe(FlightObserver);
}
```

### Muting events

Suppress listeners for a block of work, or for a single write:

```ts
await Flight.withoutEvents(async () => {
  await Flight.create({ name: "Silent" });
});

await flight.saveQuietly();
await flight.deleteQuietly();
```

Called on a model class, `withoutEvents` mutes that model only. Called on `Model` itself it mutes every model, which is what a seeder or an import usually wants:

```ts
await Model.withoutEvents(async () => {
  await User.factory().count(50).create();
  await Post.factory().count(200).create();
});
```

## Schema types and drift check

Declare columns with `declare name: string;` and the compiler trusts you. Two commands read the real table instead, so a model cannot quietly drift from its migrations.

**`bunyad schema:check`** compares each model in `app/Models` with its table and reports:

- `fillable`, `guarded`, `hidden`, `visible` or a cast naming a column the table does not have (usually a typo: `titel`)
- a primary key, or `created_at` / `updated_at`, or `deleted_at` (with `softDeletes`) that the table lacks
- a warning for columns that appear in no `fillable`, `hidden` or `casts` list

It exits with code 1 on errors (and on warnings with `--strict`), so it fits in CI:

```bash
bunyad schema:check
#   error   Flight: fillable lists [destinaton], which is not a column of [flights]
# Checked 12 models: 1 errors, 0 warnings.
```

**`bunyad schema:types`** writes an interface of each table's columns to `types/models.generated.ts` (`--out=` changes the path), using the database types and your casts (`boolean`, `json`, `date`, `decimal:2`, …). Merge it into the model class so the compiler knows every column without listing it twice:

```ts
import type { FlightColumns } from "@/types/models.generated";

export default class Flight extends Model {
  static table = "flights";
}

// Declaration merging: the class now has every column of `flights`.
export default interface Flight extends FlightColumns {}
```

Run it again after a migration. SQLite returns timestamps and booleans as text and numbers while Postgres and MySQL return `Date` and `boolean`; the generated types follow the connection you generate against, so generate them against the database you deploy to, or add casts to make the type the same everywhere.

## Known limitations

- **SQLite and concurrency.** All requests share one connection. Top-level transactions from concurrent requests queue, but plain queries issued while another request's transaction is open run inside that transaction. Use Postgres or MySQL when requests overlap.
- **Rolling back does not reset models.** After a transaction rolls back, a model saved inside it still reports `exists` and keeps its id Reload it if you need its real state.
- **Unfinished row defaults.** An empty `fillable` with the default `guarded = ["*"]` lets everything through. Set `fillable` on models that take user input.
- **Pivot events.** `attach`, `sync` and `updateExistingPivot` do not fire pivot model events, even with `using()`.
- **Encrypted JSON casts** (`encrypted:json`, `encrypted:array`) are compared by reference. Reassign them after editing.
- **Per-parent eager limits** trim in memory after one batched query, so keep the constraint selective when a parent can have very many related rows.
- **`created_at` / `updated_at` are not cast by default.** SQLite returns text, Postgres and MySQL return `Date`. Add them to `casts()` for one type everywhere.
- **Timestamps in `date:FORMAT` casts** format in UTC.

## Custom query builders

`@UseBuilder(MyQuery)` makes `newQuery()` return your `ModelQuery` subclass so you can add domain methods without global pollution.

```ts
import { Model, ModelQuery, UseBuilder } from "@bunyad/orm";

class FlightQuery extends ModelQuery<Flight> {
  domestic() {
    return this.where("type", "domestic");
  }
}

@UseBuilder(FlightQuery)
export default class Flight extends Model {
  static table = "flights";
}

await Flight.query().domestic().get();
```

## Factories

Use `@HasFactory(UserFactory)` or a static `factory()` method, then `User.factory().create()` / `make()`. Full factory docs: [ORM factories](/docs/1.x/orm-factories).
