---
title: Helpers
description: Everyday utilities for arrays, nested data, dumping, retries, and fluent values.
---

# Helpers

## Introduction

Bunyad ships small helpers you call from anywhere in the application. Most live in `@bunyad/common`. Import what you need, or rely on the globals that package installs (`collect`, `dd`, `dump`, `blank`, `filled`, `env`, and the other miscellaneous helpers listed below).

```ts
import { Arr, blank, collect, dataGet, tap } from "@bunyad/common";

const name = dataGet(user, "profile.name", "Guest");
```

URL helpers such as `route`, `url`, and `asset` are documented under [URL Generation](/docs/1.x/urls). Path helpers, number formatters, and framework-wide facades (`config`, `abort`, `view`) live with their packages; this page covers the support helpers from `@bunyad/common`.

## Available methods

### Arrays and objects

[Arr.accessible](#arr-accessible) ·
[Arr.add](#arr-add) ·
[Arr.collapse](#arr-collapse) ·
[Arr.dot](#arr-dot) ·
[Arr.except](#arr-except) ·
[Arr.exists](#arr-exists) ·
[Arr.first](#arr-first) ·
[Arr.flatten](#arr-flatten) ·
[Arr.forget](#arr-forget) ·
[Arr.get](#arr-get) ·
[Arr.has](#arr-has) ·
[Arr.isAssoc](#arr-isassoc) ·
[Arr.isList](#arr-islist) ·
[Arr.join](#arr-join) ·
[Arr.last](#arr-last) ·
[Arr.map](#arr-map) ·
[Arr.only](#arr-only) ·
[Arr.pluck](#arr-pluck) ·
[Arr.prepend](#arr-prepend) ·
[Arr.pull](#arr-pull) ·
[Arr.query](#arr-query) ·
[Arr.random](#arr-random) ·
[Arr.set](#arr-set) ·
[Arr.undot](#arr-undot) ·
[Arr.where](#arr-where) ·
[Arr.whereNotNull](#arr-wherenotnull) ·
[Arr.wrap](#arr-wrap) ·
[dataFill](#datafill) ·
[dataForget](#dataforget) ·
[dataGet](#dataget) ·
[dataSet](#dataset)

### Miscellaneous

[blank](#blank) ·
[collect](#collect) ·
[dd](#dd) ·
[defer](#defer) ·
[dump](#dump) ·
[env](#env) ·
[filled](#filled) ·
[flushDeferred](#flushdeferred) ·
[flushOnce](#flushonce) ·
[now](#now) ·
[once](#once) ·
[optional](#optional) ·
[report](#report) ·
[rescue](#rescue) ·
[rescueAsync](#rescueasync) ·
[retry](#retry) ·
[tap](#tap) ·
[throw_if](#throw_if) ·
[throw_unless](#throw_unless) ·
[today](#today) ·
[value](#value) ·
[when](#when) ·
[withValue](#withvalue)

Also on this page: [Fluent](#fluent), [Pipeline](#pipeline), and [Crypt](#crypt).

## Arrays and objects

Import `Arr` from `@bunyad/common`. Methods are static on the object.

<a name="arr-accessible"></a>
#### `Arr.accessible()`

Determine whether the value is an array or a plain object:

```ts
import { Arr } from "@bunyad/common";

Arr.accessible(["a"]); // true
Arr.accessible({ a: 1 }); // true
Arr.accessible("a"); // false
```

<a name="arr-add"></a>
#### `Arr.add()`

Set a value by key only when the key is missing (supports dotted paths via `dataSet`):

```ts
const user = { name: "Ada" };
Arr.add(user, "role", "admin");
Arr.add(user, "name", "Ignored"); // unchanged
```

<a name="arr-collapse"></a>
#### `Arr.collapse()`

Flatten an array of arrays one level:

```ts
Arr.collapse([
  [1, 2],
  [3, 4],
]); // [1, 2, 3, 4]
```

<a name="arr-dot"></a>
#### `Arr.dot()`

Flatten a nested object into dotted keys:

```ts
Arr.dot({ user: { name: "Ada", meta: { active: true } } });
// { "user.name": "Ada", "user.meta.active": true }
```

<a name="arr-except"></a>
#### `Arr.except()`

Return a shallow copy without the given keys:

```ts
Arr.except({ id: 1, name: "Ada", password: "secret" }, ["password"]);
// { id: 1, name: "Ada" }
```

<a name="arr-exists"></a>
#### `Arr.exists()`

Check whether an array index or object key exists (own property):

```ts
Arr.exists(["a", "b"], 1); // true
Arr.exists({ name: "Ada" }, "name"); // true
```

<a name="arr-first"></a>
#### `Arr.first()`

```ts
Arr.first([1, 2, 3]); // 1
Arr.first([1, 2, 3], (n) => n > 1); // 2
Arr.first([], undefined, 0); // 0
```

<a name="arr-flatten"></a>
#### `Arr.flatten()`

```ts
Arr.flatten([1, [2, [3]]]); // [1, 2, 3]
Arr.flatten([1, [2, [3]]], 1); // [1, 2, [3]]
```

<a name="arr-forget"></a>
#### `Arr.forget()`

Remove one or more dotted keys in place:

```ts
const data = { user: { name: "Ada", role: "admin" } };
Arr.forget(data, "user.role");
```

<a name="arr-get"></a>
#### `Arr.get()`

Read a value with optional default. Uses dotted paths:

```ts
Arr.get({ products: [{ name: "Desk" }] }, "products.0.name"); // "Desk"
Arr.get({}, "missing", "default");
```

<a name="arr-has"></a>
#### `Arr.has()`

Return true when every given dotted path is present (not `undefined`):

```ts
Arr.has({ a: { b: 1 } }, "a.b"); // true
Arr.has({ a: 1 }, ["a", "b"]); // false
```

<a name="arr-isassoc"></a>
#### `Arr.isAssoc()`

```ts
Arr.isAssoc({ a: 1 }); // true
Arr.isAssoc([1, 2, 3]); // false
```

<a name="arr-islist"></a>
#### `Arr.isList()`

```ts
Arr.isList([1, 2, 3]); // true
Arr.isList({ a: 1 }); // false
```

<a name="arr-join"></a>
#### `Arr.join()`

```ts
Arr.join(["a", "b", "c"], ", "); // "a, b, c"
Arr.join(["a", "b", "c"], ", ", ", and "); // "a, b, and c"
```

<a name="arr-last"></a>
#### `Arr.last()`

```ts
Arr.last([1, 2, 3]); // 3
Arr.last([1, 2, 3], (n) => n < 3); // 2
```

<a name="arr-map"></a>
#### `Arr.map()`

Map an array or the values of an object:

```ts
Arr.map([1, 2], (n) => n * 2); // [2, 4]
Arr.map({ a: 1, b: 2 }, (v, k) => `${k}:${v}`); // ["a:1", "b:2"]
```

<a name="arr-only"></a>
#### `Arr.only()`

```ts
Arr.only({ id: 1, name: "Ada", role: "admin" }, ["id", "name"]);
// { id: 1, name: "Ada" }
```

<a name="arr-pluck"></a>
#### `Arr.pluck()`

```ts
const rows = [
  { name: "Desk", price: 200 },
  { name: "Chair", price: 100 },
];

Arr.pluck(rows, "name"); // ["Desk", "Chair"]
Arr.pluck(rows, "price", "name"); // { Desk: 200, Chair: 100 }
```

<a name="arr-prepend"></a>
#### `Arr.prepend()`

```ts
Arr.prepend([1, 2], 0); // [0, 1, 2]
Arr.prepend([1, 2], "Ada", "name"); // { name: "Ada", "0": 1, "1": 2 }
```

<a name="arr-pull"></a>
#### `Arr.pull()`

Get a value and remove it:

```ts
const data = { name: "Ada", role: "admin" };
Arr.pull(data, "role"); // "admin"
```

<a name="arr-query"></a>
#### `Arr.query()`

Build a URL query string from an object:

```ts
Arr.query({ search: "desk", tags: ["wood", "oak"] });
```

<a name="arr-random"></a>
#### `Arr.random()`

```ts
Arr.random([1, 2, 3, 4]); // one item
Arr.random([1, 2, 3, 4], 2); // two items
```

<a name="arr-set"></a>
#### `Arr.set()`

Set a nested value by dotted path (mutates and returns the target):

```ts
const data = {};
Arr.set(data, "user.name", "Ada");
```

<a name="arr-undot"></a>
#### `Arr.undot()`

Expand dotted keys into a nested object:

```ts
Arr.undot({ "user.name": "Ada", "user.role": "admin" });
// { user: { name: "Ada", role: "admin" } }
```

<a name="arr-where"></a>
#### `Arr.where()`

```ts
Arr.where([1, 2, 3, 4], (n) => n % 2 === 0); // [2, 4]
```

<a name="arr-wherenotnull"></a>
#### `Arr.whereNotNull()`

```ts
Arr.whereNotNull([1, null, 2, undefined]); // [1, 2]
```

<a name="arr-wrap"></a>
#### `Arr.wrap()`

```ts
Arr.wrap("a"); // ["a"]
Arr.wrap(["a"]); // ["a"]
Arr.wrap(null); // []
```

### Nested data helpers

These functions work on objects and arrays with dotted paths. Wildcards (`*`) are supported on `dataGet` / `dataSet` where the segment is a list.

<a name="dataget"></a>
#### `dataGet()`

```ts
import { dataGet } from "@bunyad/common";

const user = {
  profile: { name: "Ada" },
  posts: [{ title: "One" }, { title: "Two" }],
};

dataGet(user, "profile.name"); // "Ada"
dataGet(user, "posts.*.title"); // ["One", "Two"]
dataGet(user, "missing", "default");
```

If the default is a function, it is called when the path is missing.

<a name="dataset"></a>
#### `dataSet()`

```ts
import { dataSet } from "@bunyad/common";

const payload: Record<string, unknown> = {};
dataSet(payload, "user.profile.name", "Ada");
```

Pass `overwrite: false` as the fourth argument to leave an existing value alone.

<a name="datafill"></a>
#### `dataFill()`

Like `dataSet`, but only writes when the path is missing:

```ts
import { dataFill } from "@bunyad/common";

const payload = { name: "Ada" };
dataFill(payload, "name", "Ignored");
dataFill(payload, "role", "admin");
```

<a name="dataforget"></a>
#### `dataForget()`

```ts
import { dataForget } from "@bunyad/common";

const payload = { user: { name: "Ada", role: "admin" } };
dataForget(payload, "user.role");
```

## Miscellaneous

Unless noted, these functions are available as named exports from `@bunyad/common` and as globals after that package loads.

<a name="blank"></a>
#### `blank()` / `filled()`

`blank` is true for `null`, `undefined`, empty / whitespace strings, empty arrays, empty collections, and empty `Map` / `Set`. `0` and `false` are **not** blank. `filled` is the inverse:

```ts
blank(null); // true
blank(""); // true
blank(0); // false
filled("Ada"); // true
```

<a name="collect"></a>
#### `collect()`

Create a [Collection](/docs/1.x/collections):

```ts
collect([1, 2, 3]).sum();
```

<a name="dd"></a>
#### `dd()` / `dump()`

`dump` prints values with `util.inspect` and continues. `dd` dumps and then stops: it throws `DdException` inside an HTTP request (the kernel can render an HTML dump page), or calls `process.exit(1)` in a normal CLI process.

```ts
dump(user, orders);
dd(request.all());
```

Use `useDdThrow(true)` or `runWithDdThrow(() => …)` in tests so `dd` throws instead of exiting. HTTP apps enable dump-page mode with `enableHttpDd()` / `runWithHttpDd()`.

<a name="env"></a>
#### `env()`

Read an environment variable from `Bun.env` (or `process.env`). Empty string is treated as missing:

```ts
env("APP_NAME", "Bunyad");
```

Prefer reading config for application settings; use `env` inside config files.

<a name="now"></a>
#### `now()` / `today()`

```ts
now(); // current Date
today(); // local midnight
```

<a name="once"></a>
#### `once()` / `flushOnce()`

Memoize a callback. Prefer a string key on Bun (call-site stacks are not a reliable identity). A function-only form memoizes by function identity — hoist the closure if you need reuse:

```ts
const token = once("app-token", () => crypto.randomUUID());
const again = once("app-token", () => crypto.randomUUID()); // same value

flushOnce(); // clears keyed memoization
```

<a name="optional"></a>
#### `optional()`

Null-safe access. Without a callback, a missing value becomes a proxy that returns further proxies / nullish primitives. With a callback, the callback runs only when the value is present:

```ts
optional(user.address)?.street;

optional(user, (u) => u.name); // null when user is null
```

<a name="report"></a>
#### `report()`

Log an error to stderr (and leave room for a custom handler later):

```ts
try {
  // …
} catch (error) {
  report(error);
}
```

<a name="rescue"></a>
#### `rescue()` / `rescueAsync()`

Run a callback and return a fallback when it throws. Exceptions are reported unless you pass `shouldReport = false`:

```ts
const value = rescue(() => JSON.parse(raw), null);

const value = await rescueAsync(async () => fetchUser(id), null);
```

<a name="retry"></a>
#### `retry()`

Retry an async callback. Optional sleep (milliseconds or a function of the attempt) and a `when` predicate:

```ts
const result = await retry(
  3,
  async (attempt) => fetchThing(attempt),
  100,
  (error) => error instanceof TypeError,
);
```

<a name="tap"></a>
#### `tap()`

Run a side-effect callback and return the original value:

```ts
return tap(user, (u) => {
  logger.info(u.id);
});
```

<a name="throw_if"></a>
#### `throw_if()` / `throw_unless()`

```ts
throw_if(!user, "User required.");
throw_unless(user.active, new Error("Inactive"));
throw_if(failed, DomainError, "code");
```

<a name="value"></a>
#### `value()`

Invoke a function argument; otherwise return the value as-is:

```ts
value(5); // 5
value(() => 5); // 5
```

<a name="when"></a>
#### `when()`

If the condition is truthy, return the value (invoking it when it is a function). Otherwise return the optional default:

```ts
when(user.isAdmin, "admin", "user");
when(flag, () => compute(), () => fallback());
```

<a name="withvalue"></a>
#### `withValue()`

Pass a value into a callback and return the callback’s result (or the value when no callback is given). Named `withValue` because `with` is reserved in JavaScript:

```ts
withValue(user, (u) => u.name.toUpperCase());
```

<a name="defer"></a>
#### `defer()` / `flushDeferred()`

Queue work to run after the current turn. The HTTP kernel calls `flushDeferred()` after the response. Mark a job with `.always()` so it still runs when the request failed:

```ts
defer(async () => {
  await indexSearch(user);
}).always();

await flushDeferred();
await flushDeferred({ failed: true }); // skips non-always jobs
```

To run several independent tasks after the response, wrap them in `Promise.all` inside `defer` — see [Concurrency](/docs/1.x/concurrency).

## Fluent

`Fluent` is a small attribute bag with typed readers and conditional helpers:

```ts
import { Fluent } from "@bunyad/common";

const input = Fluent.make({
  name: "Ada",
  age: "36",
  tags: ["admin"],
});

input.string("name");
input.integer("age");
input.array("tags");
input.boolean("active", false);
input.only("name", "age");
input.whenHas("name", (f) => {
  console.log(f.str("name"));
});
```

Useful methods include `get` / `set` / `fill`, `has` / `missing` / `filled`, `collect`, `enum` / `enums`, `scope`, `when` / `unless`, and JSON helpers (`toArray`, `toJson`, `toPrettyJson`).

## Pipeline

Pass a value through a series of pipes, then a destination. Pipes may be functions `(passable, next) => …`, objects with a `handle` method, or classes:

```ts
import { Pipeline } from "@bunyad/common";

const result = await Pipeline.send(user)
  .through([trimName, ensureActive])
  .then((u) => u);

await Pipeline.send(order)
  .pipe(ValidateOrder)
  .via("handle")
  .finally((o) => console.log(o.id))
  .thenReturn();
```

`when` / `unless` on the pipeline instance conditionally register more pipes. `thenReturn()` runs the stack and returns the passable.

## Crypt

`Crypt` encrypts and decrypts strings with AES-256-GCM using `APP_KEY`:

```ts
import { Crypt } from "@bunyad/common";

const payload = Crypt.encrypt("secret");
const plain = Crypt.decrypt(payload);
```

Generate a key with `Crypt.generateKey()` and set `APP_KEY` before using encryption in production. Tests may call `Crypt.setKey(...)`.
