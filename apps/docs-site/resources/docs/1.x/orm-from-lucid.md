---
title: Coming from Lucid
description: Map AdonisJS Lucid models, queries, hooks and relations to the Bunyad ORM.
---

# Coming from Lucid

## Introduction

Lucid and the Bunyad ORM are both Active Record ORMs for TypeScript. Lucid uses decorators and Knex's query builder; Bunyad uses Eloquent's method names with plain classes. This page maps the common Lucid pieces.

## Models

```ts
// Lucid
export default class User extends BaseModel {
  @column({ isPrimary: true }) declare id: number;
  @column() declare email: string;
  @column.dateTime({ autoCreate: true }) declare createdAt: DateTime;
}

// Bunyad
export default class User extends Model {
  static table = "users";
  static fillable = ["email"];
  static casts() {
    return { created_at: "datetime" as const };
  }
  declare id: number;
  declare email: string;
  declare created_at: Date;
}
```

| Lucid | Bunyad |
| --- | --- |
| `@column()` per field | `declare field: type` plus `static fillable` / `casts()` |
| `columnName` mapping, camelCase to snake_case | Attributes keep the column name (`created_at`) |
| `@column.dateTime({ autoCreate })` with Luxon `DateTime` | `Date`; timestamps are automatic (`static timestamps`) |
| `@column({ serializeAs: null })` | `static hidden = ["password"]` |
| `@column({ prepare, consume })` | `Attribute.make({ get, set })` or a cast |
| `@computed()` | `static appends` with an accessor |
| `Model.query()` | `Model.query()` (or call builder methods on the class: `User.where(...)`) |

## Queries

| Lucid | Bunyad |
| --- | --- |
| `User.find(1)`, `findOrFail`, `findBy('email', x)` | `User.find(1)`, `findOrFail`, `User.where("email", x).first()` |
| `User.query().preload('posts')` | `User.with("posts")` |
| `preload('posts', q => q.where(...))` | `with({ posts: (q) => q.where(...) })` |
| `query().paginate(page, limit)` | `paginate(perPage, page)` — **the arguments are swapped** |
| `User.firstOrCreate(search, payload)` | `User.firstOrCreate(search, values)` |
| `User.updateOrCreate`, `createMany` | `updateOrCreate`, `Model.insert([...])` / `upsert` |
| `query().whereHas` is `whereHas('posts', q => ...)` | Same |
| `withCount('posts')` gives `$extras.posts_count` | `withCount("posts")` gives `user.posts_count` |
| `query().first()`, `firstOrFail()`, `.exec()` | `first()`, `firstOrFail()`, `get()` |
| `user.$dirty`, `user.$isDirty` | `user.getDirty()`, `user.isDirty()` |
| `user.serialize()` | `user.toJSON()` / `JSON.stringify(user)` |

## Relations

| Lucid | Bunyad |
| --- | --- |
| `@hasMany(() => Post)` | `posts() { return this.hasMany(Post); }` |
| `@belongsTo(() => User)` | `user() { return this.belongsTo(User); }` |
| `@manyToMany(() => Team)` | `teams() { return this.belongsToMany(Team); }` |
| `@hasManyThrough` | `hasManyThrough` |
| `user.related('posts').create({...})` | `user.posts().create({...})` |
| `user.related('teams').attach([1, 2])` | `user.teams().attach([1, 2])` |
| `user.related('teams').sync([1, 2])` | `user.teams().sync([1, 2])`; returns what was attached, detached and updated |
| `pivotColumns: ['role']` | `.withPivot("role")` |
| `await user.load('posts')` | `await user.load("posts")` |

Polymorphic relations (`morphTo`, `morphMany`, `morphToMany`, `morphedByMany`) are built in; Lucid has no first-party equivalent.

## Hooks and events

| Lucid hook | Bunyad event |
| --- | --- |
| `@beforeSave`, `@afterSave` | `saving`, `saved` |
| `@beforeCreate`, `@afterCreate` | `creating`, `created` |
| `@beforeUpdate`, `@afterUpdate` | `updating`, `updated` |
| `@beforeDelete`, `@afterDelete` | `deleting`, `deleted` |
| `@beforeFind`, `@beforeFetch` | Global scopes (`addGlobalScope`) |
| `@afterFind`, `@afterFetch` | `retrieved` |

Register listeners with `static booted() { this.creating(...) }` or group them in an observer class and call `Model.observe(...)`. Returning `false` from a `-ing` event cancels the write.

## Transactions

```ts
// Lucid
await db.transaction(async (trx) => {
  const user = await User.create({ email }, { client: trx });
});

// Bunyad — no transaction argument; queries inside the callback join it
await DB.transaction(async () => {
  const user = await User.create({ email });
});
```

## Things Bunyad adds

- Soft deletes (`static softDeletes = true`)
- Global and local scopes, model events, observers with `afterCommit`
- Factories with states, sequences and relationship helpers
- Polymorphic relations and API resources
- Relation aggregates with constraints: `withSum({ "payments as paid": (q) => q.where(...) }, "amount")`
