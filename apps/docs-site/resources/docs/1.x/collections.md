---
title: Collections
description: Wrap arrays in a fluent Collection for map, filter, pluck, sort, and more.
---

# Collections

## Introduction

The `Collection` class is a fluent wrapper around a list of items. Use `collect` to create one, chain transforms, and read values when you are done:

```ts
import { collect } from "@bunyad/common";

const collection = collect(["Taylor", "Abigail", null])
  .map((name) => (name == null ? "" : name.toUpperCase()))
  .reject((name) => name === "");

collection.all();
// ["TAYLOR", "ABIGAIL"]
```

Most methods return a **new** collection. A few mutate in place (`push`, `put`, `transform`, `splice`, and similar). Prefer collection methods over converting with `all()` / `toArray()` until you hit an HTTP or JSON boundary that needs a plain array.

Numeric index access works on the instance: `collection[0]` reads the first item.

`collect`, `Collection`, and the other helpers below are exported from `@bunyad/common`. Importing that package also installs `collect` on `globalThis` when globals are enabled.

### Creating collections

```ts
import { Collection, collect } from "@bunyad/common";

const collection = collect([1, 2, 3]);

Collection.make([1, 2, 3]);
Collection.empty();
Collection.times(3, (n) => n * 2); // [2, 4, 6]
Collection.range(1, 5); // [1, 2, 3, 4, 5]
Collection.wrap("a"); // ["a"]
Collection.wrap(["a", "b"]); // ["a", "b"]
Collection.unwrap(collect([1])); // [1]
Collection.fromJson('["a","b"]');
```

`Collection.fromOwned(items)` wraps an array you already own without copying. Prefer it on hot hydrate / map / filter paths. The public constructor still copies.

```ts
import User from "@/Models/User.ts";

const users = await User.query().get();
const names = collect(users).pluck("name");
```

## Available methods

For the remainder of this documentation, we discuss each method available on the `Collection` class. All method signatures are documented on the class itself; the examples below show typical usage.

<a name="method-listing"></a>
## Method listing

#### `after()`

Return the item after the given value or predicate. Returns `null` when there is no next item:

```ts
collect([1, 2, 3, 4]).after(2); // 3
collect([1, 2, 3]).after((n) => n > 1); // 3
```

#### `all()`

Return the underlying array. The array is live — mutating it mutates the collection:

```ts
collect([1, 2, 3]).all(); // [1, 2, 3]
```

#### `average()` / `avg()`

Compute the average of items, or of a key / callback:

```ts
collect([1, 1, 2, 4]).avg(); // 2
collect([{ price: 10 }, { price: 20 }]).avg("price"); // 15
```

Empty collections return `null`.

#### `before()`

Return the item before the given value or predicate:

```ts
collect([1, 2, 3, 4]).before(3); // 2
```

#### `chunk()`

Break the collection into collections of the given size:

```ts
collect([1, 2, 3, 4, 5]).chunk(2).all();
// [Collection[1, 2], Collection[3, 4], Collection[5]]
```

#### `chunkWhile()`

Chunk while the callback returns truthy for consecutive items; start a new chunk when it returns falsy:

```ts
collect([1, 2, 10, 11, 3])
  .chunkWhile((n) => n < 10)
  .map((c) => c.all())
  .all();
```

#### `collapse()`

Collapse a collection of arrays (or nested collections) one level:

```ts
collect([[1, 2], [3, 4]]).collapse().all(); // [1, 2, 3, 4]
```

`collapseWithKeys()` is an alias of `collapse()`.

#### `collect()`

Return a new `Collection` with a copy of the items:

```ts
const copy = collect([1, 2]).collect();
```

#### `combine()`

Combine the collection’s values as keys with another list of values:

```ts
collect(["name", "age"]).combine(["Ada", 36]).all();
// [["name", "Ada"], ["age", 36]]
```

#### `concat()` / `merge()`

Append items from an array or another collection:

```ts
collect([1, 2]).concat([3, 4]).all(); // [1, 2, 3, 4]
```

#### `contains()` / `some()`

Determine if the collection contains a value, or passes a predicate / key comparison:

```ts
collect([1, 2, 3]).contains(2); // true
collect([{ id: 1 }]).contains("id", 1); // true
collect([1, 2, 3]).contains((n) => n > 2); // true
```

`containsStrict()` uses `===`. `doesntContain()` / `doesntContainStrict()` invert the check.

#### `containsOneItem()` / `containsManyItems()`

```ts
collect([1]).containsOneItem(); // true
collect([1, 2]).containsManyItems(); // true
collect([1, 2, 3]).containsOneItem((n) => n > 2); // true
```

#### `count()`

```ts
collect([1, 2, 3]).count(); // 3
```

The instance also exposes `length` for the same number.

#### `countBy()`

Count occurrences by value or by a key / callback. Returns a collection of the count numbers:

```ts
collect([1, 2, 2, 3]).countBy().all(); // [1, 2, 1]
collect([{ type: "a" }, { type: "a" }, { type: "b" }])
  .countBy("type")
  .all(); // [2, 1]
```

#### `crossJoin()`

Cross join the collection’s values among the given arrays:

```ts
collect([1, 2]).crossJoin(["a", "b"]).all();
// [[1, "a"], [1, "b"], [2, "a"], [2, "b"]]
```

#### `dd()` / `dump()`

`dump()` logs the items and returns the collection. `dd()` dumps and then throws `DdException` (or exits in CLI when HTTP dump mode is off):

```ts
collect([1, 2, 3]).dump();
```

#### `diff()` / `diffUsing()`

Return items not present in the other list:

```ts
collect([1, 2, 3]).diff([2]).all(); // [1, 3]
collect(["a", "b"]).diffUsing(["A"], (a, b) =>
  a.toLowerCase() === b.toLowerCase() ? 0 : 1,
);
```

`diffAssoc()` / `diffAssocUsing()` alias `diff` / `diffUsing` for list collections.

#### `diffKeys()` / `diffKeysUsing()`

Keep items whose **indexes** are not present in the other list or object’s keys:

```ts
collect(["a", "b", "c"]).diffKeys(["x"]).all(); // ["b", "c"]
```

#### `dot()`

Flatten nested objects into dotted values (collection of leaf values):

```ts
collect([{ user: { name: "Ada" } }]).dot().all();
```

#### `duplicates()` / `duplicatesStrict()`

Return one representative item for each duplicated value (or key):

```ts
collect([1, 2, 2, 3, 3]).duplicates().all(); // [2, 3]
collect([{ id: 1 }, { id: 1 }, { id: 2 }]).duplicates("id").all();
```

#### `each()` / `forEach()`

Iterate. Return `false` from the callback to break:

```ts
collect([1, 2, 3]).each((n, i) => {
  console.log(n, i);
});
```

#### `eachSpread()`

When items are arrays, spread them into the callback arguments:

```ts
collect([
  [1, 2],
  [3, 4],
]).eachSpread((a, b) => {
  console.log(a, b);
});
```

#### `ensure()`

Throw if any item fails the type check (`typeof` string or constructor):

```ts
collect([1, 2]).ensure("number");
collect([new Date()]).ensure(Date);
```

#### `every()`

```ts
collect([2, 4, 6]).every((n) => n % 2 === 0); // true
```

#### `except()` / `only()`

Keep or drop items by **index**:

```ts
collect(["a", "b", "c"]).only([0, 2]).all(); // ["a", "c"]
collect(["a", "b", "c"]).except([1]).all(); // ["a", "c"]
```

#### `filter()` / `reject()`

```ts
collect([1, 2, 3, null, false])
  .filter()
  .all(); // [1, 2, 3]

collect([1, 2, 3])
  .filter((n) => n > 1)
  .all(); // [2, 3]

collect([1, 2, 3])
  .reject((n) => n > 1)
  .all(); // [1]
```

#### `first()` / `firstOrFail()` / `firstWhere()` / `last()`

```ts
collect([1, 2, 3]).first(); // 1
collect([1, 2, 3]).first((n) => n > 1); // 2
collect([1, 2, 3]).first((n) => n > 9, 0); // 0

collect([{ name: "Desk", price: 200 }]).firstWhere("price", 200);

collect([1, 2, 3]).last(); // 3
collect([]).firstOrFail(); // throws
```

#### `flatMap()`

Map each item to an array or collection, then flatten one level:

```ts
collect([1, 2])
  .flatMap((n) => [n, n * 10])
  .all(); // [1, 10, 2, 20]
```

#### `flatten()`

Flatten nested arrays / collections to the given depth (default `Infinity`):

```ts
collect([1, [2, [3]]]).flatten().all(); // [1, 2, 3]
collect([1, [2, [3]]]).flatten(1).all(); // [1, 2, [3]]
```

#### `flip()`

Pair each value with its index:

```ts
collect(["a", "b"]).flip().all(); // [["a", 0], ["b", 1]]
```

#### `forget()`

Remove items by index (mutates):

```ts
collect(["a", "b", "c"]).forget(1).all(); // ["a", "c"]
```

#### `forPage()`

Slice a page of results (1-based page number):

```ts
collect([1, 2, 3, 4, 5, 6]).forPage(2, 2).all(); // [3, 4]
```

#### `fromJson()`

```ts
Collection.fromJson("[1,2,3]");
```

#### `get()` / `getOrPut()` / `put()` / `pull()` / `has()` / `hasAny()` / `hasMany()` / `hasSole()`

Index-based access and mutation:

```ts
const c = collect(["a", "b", "c"]);

c.get(1); // "b"
c.has(0, 2); // true
c.hasAny(5, 1); // true

c.put(1, "B");
c.getOrPut(3, () => "d");
c.pull(0); // "a", collection no longer contains it
```

#### `groupBy()`

Group items by key or callback. Returns a collection of collections (group values):

```ts
collect([
  { dept: "Sales", name: "Ada" },
  { dept: "Sales", name: "Lin" },
  { dept: "IT", name: "Sam" },
])
  .groupBy("dept")
  .map((group) => group.pluck("name").all())
  .all();
// [["Ada", "Lin"], ["Sam"]]
```

#### `implode()` / `join()`

```ts
collect(["a", "b", "c"]).implode(", "); // "a, b, c"
collect([{ name: "Ada" }, { name: "Lin" }]).implode(" / ", "name");

collect(["a", "b", "c"]).join(", ", ", and "); // "a, b, and c"
```

#### `intersect()` / `intersectUsing()` / `intersectByKeys()`

```ts
collect([1, 2, 3]).intersect([2, 3, 4]).all(); // [2, 3]
collect(["a", "b", "c"]).intersectByKeys(["x", "y"]).all(); // ["a", "b"]
```

`intersectAssoc()` / `intersectAssocUsing()` alias the value-based intersect helpers.

#### `isEmpty()` / `isNotEmpty()`

```ts
collect([]).isEmpty(); // true
collect([1]).isNotEmpty(); // true
```

#### `keyBy()`

Re-key by attribute, keeping the last item for each key. Returns the values in encounter order:

```ts
collect([
  { id: 1, name: "a" },
  { id: 2, name: "b" },
])
  .keyBy("id")
  .all();
```

#### `keys()` / `values()`

```ts
collect(["a", "b"]).keys().all(); // [0, 1]
collect(["a", "b"]).values().all(); // ["a", "b"]
```

#### `make()` / `times()` / `range()` / `wrap()` / `unwrap()` / `empty()`

Static constructors — see [Creating collections](#creating-collections).

#### `map()` / `mapInto()` / `mapSpread()` / `mapWithKeys()` / `mapToDictionary()` / `mapToGroups()`

```ts
collect([1, 2]).map((n) => n * 2).all(); // [2, 4]

class Box {
  constructor(public value: number) {}
}
collect([1, 2]).mapInto(Box);

collect([
  [1, 2],
  [3, 4],
])
  .mapSpread((a, b) => a + b)
  .all(); // [3, 7]

collect([{ name: "Ada" }])
  .mapWithKeys((user) => ({ [user.name]: user }))
  .all();
```

#### `max()` / `min()` / `median()` / `mode()` / `sum()` / `percentage()`

```ts
collect([1, 2, 3]).max(); // 3
collect([{ n: 1 }, { n: 9 }]).min("n"); // 1
collect([1, 2, 2, 3]).median(); // 2
collect([1, 1, 2, 2]).mode(); // [1, 2]
collect([1, 2, 3]).sum(); // 6
collect([1, 2, 3, 4]).percentage((n) => n % 2 === 0); // 50
```

#### `mergeRecursive()`

Merge another list, or shallow-merge an object into each object item:

```ts
collect([{ a: 1 }]).mergeRecursive({ b: 2 }).all();
// [{ a: 1, b: 2 }]
```

#### `multiply()`

Repeat the list `times` times:

```ts
collect([1, 2]).multiply(2).all(); // [1, 2, 1, 2]
```

#### `nth()`

Take every nth item, optionally starting at an offset:

```ts
collect([1, 2, 3, 4, 5, 6]).nth(2).all(); // [1, 3, 5]
collect([1, 2, 3, 4, 5, 6]).nth(2, 1).all(); // [2, 4, 6]
```

#### `pad()`

Pad to a target length. Negative size pads at the start:

```ts
collect([1, 2]).pad(4, 0).all(); // [1, 2, 0, 0]
collect([1, 2]).pad(-4, 0).all(); // [0, 0, 1, 2]
```

#### `partition()`

Split into `[pass, fail]` collections:

```ts
const [even, odd] = collect([1, 2, 3, 4]).partition((n) => n % 2 === 0);
```

#### `pipe()` / `pipeInto()` / `pipeThrough()`

```ts
const total = collect([1, 2, 3]).pipe((c) => c.sum());

collect([1, 2]).pipeInto(Array); // via ctor(items)

collect([1, 2, 3]).pipeThrough([
  (c) => c.filter((n) => n > 1),
  (c) => c.map((n) => n * 10),
]);
```

#### `pluck()`

```ts
collect([
  { product_id: "prod-100", name: "Desk" },
  { product_id: "prod-200", name: "Chair" },
])
  .pluck("name")
  .all(); // ["Desk", "Chair"]
```

With a second argument, Bunyad returns a **plain object** keyed by that column (Laravel’s associative array). `Collection` itself stays list-backed, so the keyed form is a `Record` — the same shape as `Arr.pluck(rows, value, key)`. Duplicate keys keep the last value:

```ts
collect([
  { product_id: "prod-100", name: "Desk" },
  { product_id: "prod-200", name: "Chair" },
]).pluck("name", "product_id");
// { "prod-100": "Desk", "prod-200": "Chair" }
```

#### `pop()` / `shift()` / `push()` / `prepend()` / `unshift()` / `add()`

Mutating stack operations:

```ts
const c = collect([1, 2, 3]);
c.pop(); // 3
c.shift(); // 1
c.push(4, 5);
c.prepend(0);
c.add(6);
```

`pop(n)` / `shift(n)` with `n > 1` return a collection of removed items.

#### `random()` / `shuffle()`

```ts
collect([1, 2, 3, 4]).random(); // one item
collect([1, 2, 3, 4]).random(2); // collection of two
collect([1, 2, 3]).shuffle();
```

#### `reduce()` / `reduceInto()` / `reduceSpread()` / `reduceWithKeys()`

```ts
collect([1, 2, 3]).reduce((carry, n) => carry + n, 0); // 6

collect([1, 2, 3]).reduceInto((bag, n) => {
  bag.total += n;
}, { total: 0 });
```

#### `replace()` / `replaceRecursive()`

Replace items by index from another list:

```ts
collect(["a", "b", "c"]).replace(["x"]).all(); // ["x", "b", "c"]
```

#### `reverse()`

```ts
collect([1, 2, 3]).reverse().all(); // [3, 2, 1]
```

#### `search()`

Return the index of a value or predicate, or `false`:

```ts
collect(["a", "b", "c"]).search("b"); // 1
collect([1, 2, 3]).search((n) => n > 2); // 2
```

#### `select()`

Pick keys from each object item:

```ts
collect([{ id: 1, name: "Ada", role: "admin" }])
  .select("id", "name")
  .all();
// [{ id: 1, name: "Ada" }]
```

#### `skip()` / `skipUntil()` / `skipWhile()` / `take()` / `takeUntil()` / `takeWhile()` / `slice()`

```ts
collect([1, 2, 3, 4]).skip(2).all(); // [3, 4]
collect([1, 2, 3, 4]).take(2).all(); // [1, 2]
collect([1, 2, 3, 4]).take(-2).all(); // [3, 4]
collect([1, 2, 3, 4]).slice(1, 2).all(); // [2, 3]

collect([1, 2, 3, 4]).skipUntil(3).all(); // [3, 4]
collect([1, 2, 3, 4]).takeWhile((n) => n < 3).all(); // [1, 2]
```

#### `sliding()`

Sliding windows of `size` with optional `step`:

```ts
collect([1, 2, 3, 4])
  .sliding(2)
  .map((c) => c.all())
  .all();
// [[1, 2], [2, 3], [3, 4]]
```

#### `sole()`

Return the only item matching the optional predicate. Throws when zero or many match:

```ts
collect([1, 2, 3]).sole((n) => n === 2); // 2
```

#### `sort()` / `sortDesc()` / `sortBy()` / `sortByDesc()` / `sortByMany()`

```ts
collect([3, 1, 2]).sort().all(); // [1, 2, 3]
collect([1, 2, 3]).sortDesc().all(); // [3, 2, 1]

collect([{ name: "Desk", price: 200 }, { name: "Chair", price: 100 }])
  .sortBy("price")
  .all();

collect(rows).sortByMany([["last", "asc"], ["first", "desc"]]);
```

#### `sortKeys()` / `sortKeysDesc()` / `sortKeysUsing()`

Reorder by numeric indexes (useful after associative-style operations that still store a list):

```ts
collect(["a", "b", "c"]).sortKeysDesc().all(); // ["c", "b", "a"]
```

#### `splice()`

Remove a portion (and optionally replace), mutating the collection. Returns the removed items:

```ts
const c = collect([1, 2, 3, 4]);
const removed = c.splice(1, 2, [9]);
removed.all(); // [2, 3]
c.all(); // [1, 9, 4]
```

#### `split()` / `splitIn()`

Split into a number of groups:

```ts
collect([1, 2, 3, 4, 5, 6])
  .split(3)
  .map((c) => c.all())
  .all();
// [[1, 2], [3, 4], [5, 6]]
```

#### `tap()`

Run a side-effect callback and return the same collection:

```ts
collect([1, 2, 3]).tap((c) => console.log(c.count()));
```

#### `toArray()` / `toJSON()` / `toJson()` / `toPrettyJson()` / `toBase()`

```ts
collect([1, 2]).toArray(); // same as all()
collect([{ toJSON: () => ({ ok: true }) }]).toJSON();
collect([1, 2]).toJson();
collect([1, 2]).toPrettyJson();
collect([1, 2]).toBase(); // new Collection copy
```

#### `transform()`

Map in place and return `this`:

```ts
collect([1, 2, 3]).transform((n) => n * 2).all(); // [2, 4, 6]
```

#### `undot()`

Rebuild a nested object from `[path, value]` pairs when every item is a two-element path tuple:

```ts
collect([
  ["user.name", "Ada"],
  ["user.role", "admin"],
])
  .undot()
  .first();
// { user: { name: "Ada", role: "admin" } }
```

#### `union()`

Concatenate then unique:

```ts
collect([1, 2]).union([2, 3]).all(); // [1, 2, 3]
```

#### `unique()` / `uniqueStrict()`

```ts
collect([1, 2, 2, 3]).unique().all(); // [1, 2, 3]
collect([{ id: 1 }, { id: 1 }, { id: 2 }]).unique("id").all();
```

#### `value()`

Read a key from the first item, or the first item itself:

```ts
collect([{ name: "Ada" }]).value("name"); // "Ada"
collect([9]).value(); // 9
```

#### `when()` / `unless()` / `whenEmpty()` / `whenNotEmpty()` / `unlessEmpty()` / `unlessNotEmpty()`

Conditionally run a callback against the collection. Always returns the same collection instance:

```ts
collect([1, 2, 3]).when(true, (c) => {
  c.push(4);
});

collect([]).whenEmpty((c) => {
  c.push("default");
});
```

#### `where()` family

Filter by attribute. Two-argument form uses `=`. Operators: `=`, `==`, `===`, `!=`, `<>`, `!==`, `<`, `<=`, `>`, `>=`.

```ts
const products = collect([
  { product: "Desk", price: 200 },
  { product: "Chair", price: 100 },
  { product: "Bookcase", price: 150 },
]);

products.where("price", 100);
products.where("price", ">", 100);
products.whereStrict("price", 100);
products.whereIn("price", [100, 150]);
products.whereNotIn("price", [200]);
products.whereBetween("price", [100, 150]);
products.whereNotBetween("price", [100, 150]);
products.whereNull("optional");
products.whereNotNull("product");
products.whereInstanceOf(Date);
```

`whereInStrict` / `whereNotInStrict` compare with `===`.

#### `zip()`

```ts
collect(["a", "b"]).zip([1, 2]).all();
// [["a", 1], ["b", 2]]
```
