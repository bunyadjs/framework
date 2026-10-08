---
title: Coming from Eloquent
description: What is the same, what is different, and what to watch for when you move Laravel Eloquent models to the Bunyad ORM.
---

# Coming from Eloquent

## Introduction

The Bunyad ORM keeps Eloquent's method names and argument order, so most code translates one to one. The differences come from JavaScript: everything that touches the database is asynchronous, there are no magic properties, and values are plain `Date`, `string` and `number` instead of Carbon and PHP types. This page lists the differences that matter.

## The same

| Eloquent | Bunyad |
| --- | --- |
| `User::where('active', 1)->orderBy('name')->get()` | `await User.where("active", 1).orderBy("name").get()` |
| `User::with('posts')->find(1)` | `await User.with("posts").find(1)` |
| `whereHas`, `has`, `doesntHave`, `withCount`, `withSum`, `withExists` | Same names, constraint closures included |
| `belongsTo`, `hasMany`, `hasOne`, `belongsToMany`, `morphTo`, `morphMany`, `morphToMany`, `morphedByMany`, `hasManyThrough` | Same names |
| `attach`, `detach`, `sync`, `syncWithoutDetaching`, `toggle`, `updateExistingPivot`, `wherePivot`, `withPivot`, `withTimestamps`, `using`, `as` | Same names |
| `firstOrCreate`, `updateOrCreate`, `upsert`, `chunkById`, `paginate($perPage, $page)`, `cursorPaginate` | Same names and argument order |
| `isDirty`, `getDirty`, `getOriginal`, `wasChanged`, `getChanges`, `getPrevious`, `isClean` | Same names |
| `creating`, `created`, `saving`, `saved`, `deleting`, `trashed`, `restoring`, observers, `afterCommit` | Same names and order |
| Global scopes, local scopes (`scopeActive`), `withoutGlobalScopes` | Same ideas |
| `SoftDeletes`: `withTrashed`, `onlyTrashed`, `restore`, `forceDelete` | `static softDeletes = true`, same methods |
| `Model::factory()->count(3)->create()`, states, sequences, `for`, `has`, `recycle` | Same names |
| `forceFill`, `isFillable`, `Model::unguard()`, `Model::unguarded($fn)` | Same names |
| `Model::preventLazyLoading()`, `preventSilentlyDiscardingAttributes()` | Same names |
| `casts`: `boolean`, `integer`, `decimal:2`, `date:Y-m-d`, `datetime`, `array`, `collection`, `encrypted`, `hashed`, enum | Same names; an unknown cast name throws |

## Different

### Everything is `await`ed

```ts
const user = await User.find(1);
const posts = await user.posts().get();
```

Forgetting an `await` is the most common mistake. A model query returns a promise (on SQLite a few calls may return a value directly, so always `await`).

### Relationships are not lazy properties

`$user->posts` lazy-loads in PHP. A JavaScript property cannot run an async query, so a relation property exists only after you load it:

```ts
const user = await User.with("posts").find(1); // eager load
user.posts;                                    // the loaded collection

await user.load("posts");                      // or load later
const fresh = await user.posts().get();        // or query the relation directly
```

Call `Model.preventLazyLoading(true)` (or `Model.shouldBeStrict(true)` in development) to throw when code queries a relation that was not eager loaded.

### Model properties are `static`

| Eloquent | Bunyad |
| --- | --- |
| `protected $table`, `$primaryKey`, `$timestamps` | `static table`, `static primaryKey`, `static timestamps` |
| `protected $fillable`, `$guarded`, `$hidden`, `$visible`, `$appends` | `static fillable`, `guarded`, `hidden`, `visible`, `appends` |
| `protected $casts` / `casts()` | `static casts()` |
| `use SoftDeletes` | `static softDeletes = true` |
| `protected static function booted()` | `static booted()` |

Declare columns for TypeScript with `declare name: string;`. They exist only for the type checker and do not create properties at runtime.

### Mass assignment

With an empty `fillable` and the default `guarded = ["*"]`, Laravel assigns nothing. Bunyad assigns everything, so a new model works before you list columns. Set `fillable` on every model that takes user input.

### Collections

Query results are an `OrmCollection`. It has the Laravel collection methods, and `.all()` returns a plain array. Keep `.all()` at the edge (an API response, a `for...of` loop) rather than converting early.

### Values are plain JavaScript

- Dates are `Date`, not Carbon. Use `date:FORMAT` casts to control serialized output.
- `decimal:2` reads as a string (`"12.50"`) to keep the exact value. Plain `decimal` and `float` read as numbers.
- `created_at` and `updated_at` are not cast by default. SQLite returns text, while Postgres and MySQL return `Date`. Cast them as `datetime` if your code needs the same type on every driver.
- `toJson()` returns the object, not a string. Use `JSON.stringify(model)`.

### Transactions have no connection argument

```ts
await DB.transaction(async () => {
  await Account.where("id", 1).decrement("balance", 100);
  await Account.where("id", 2).increment("balance", 100);
});
```

Queries inside the callback join the transaction through async context. On SQLite, concurrent top-level transactions queue; use Postgres or MySQL when requests overlap.

### Not included

Blade, Horizon, Telescope and Scout's hosted engines are separate. Search lives in `@bunyad/search`, queues in `@bunyad/queue`, and billing in `@bunyad/billing`.
