---
title: Cache
description: Store and retrieve values with memory, file, Redis, or database drivers.
---

# Cache

## Introduction

The cache stores a value under a string key for a period of time, or forever. Use it for expensive queries, computed pages, and short-lived flags. Read and write through the `Cache` facade or the `cache()` helper. Both talk to the default repository set at boot.

```ts
import { Cache } from "@bunyad/cache";

await Cache.put("users", users, 60);
const users = await Cache.get("users");
```

## Configuration

Framework apps read `config/cache.ts`. The default store is `CACHE_DRIVER`, or `memory` when that variable is unset:

```ts
export default {
  default: process.env.CACHE_DRIVER ?? "memory",
  stores: {
    memory: { driver: "memory" },
    file: { driver: "file" },
    redis: {
      driver: "redis",
      connection: "cache",
      url: process.env.REDIS_URL,
    },
    database: {
      driver: "database",
      table: "cache",
    },
  },
};
```

`CacheServiceProvider` registers every store under `config/cache.ts` via `setCacheStore`, and sets the default with `setCache`. Drivers:

| Driver | Backend |
| --- | --- |
| `memory` | In-process map. Lost when the process exits. Default for local work. |
| `file` | One JSON file per key under `storage/framework/cache` (or `stores.file.path`). |
| `redis` | Bun's Redis client. URL from the store config, the Redis connection named `cache`, or `REDIS_URL`. Keys are prefixed with `bunyad:` by default. |
| `database` | Rows in a `cache` table (`key`, `value`, `expiration`) on the default DB connection (or `stores.*.connection`). |

A minimal app that does not load the framework provider also calls `setCache` with a store of its choice (see also [using packages alone](/docs/1.x/standalone)):

```ts
import { CacheRepository, MemoryCacheStore, setCache } from "@bunyad/cache";

setCache(new CacheRepository(new MemoryCacheStore()));
```

### Named stores

`Cache.store("redis")` resolves a repository registered from config (or with `setCacheStore`):

```ts
await Cache.store("redis").put("key", "value", 60);
await Cache.store("database").get("key");
```

## Retrieving items

`get` returns the value, or the default when the key is missing. The default may be a plain value or a callback invoked only on miss (the result is not stored — use `remember` for that). Missing without a default is `undefined`.

```ts
const value = await Cache.get("key");
const value = await Cache.get("key", "default");
const value = await Cache.get("key", () => expensiveDefault());
```

Typed helpers throw when the stored value is the wrong kind:

```ts
await Cache.string("name");
await Cache.integer("count");
await Cache.float("ratio");
await Cache.boolean("enabled");
await Cache.array("ids");
```

`has` / `missing` report presence. `pull` returns the value and deletes the key. `many` and `getMultiple` load several keys at once (missing keys are `undefined`, or the default you pass to `getMultiple`).

```ts
await Cache.has("key");
await Cache.missing("key");
await Cache.pull("key");
await Cache.many(["a", "b"]);
```

`increment` and `decrement` change a numeric value and return the new number. A missing key starts from zero.

## Storing items

`put` writes a value. The third argument is a TTL in whole seconds **or a `Date`**. Omit it (or use `forever`) to keep the value until you delete it. `set` is the same as `put` and resolves to `true`.

```ts
await Cache.put("key", "value", 60);
await Cache.put("key", "value", new Date(Date.now() + 60_000));
await Cache.forever("key", "value");
await Cache.putMany({ a: 1, b: 2 }, 60);
await Cache.putManyForever({ a: 1, b: 2 });
```

`add` stores only when the key is absent. It returns `true` when the write happened. Redis and memory prefer an atomic set-if-absent path, which queue overlap middleware uses as a mutex.

```ts
const stored = await Cache.add("lock:job", 1, 30);
```

### Atomic locks

`Cache.lock(name, seconds)` acquires a SETNX-style lock (owner token in cache). Use it when only one worker should run a critical section:

```ts
const lock = Cache.lock("orders:import", 10);

if (await lock.get()) {
  // … exclusive work …
  await lock.release();
}

await Cache.lock("orders:import", 10).get(async () => {
  // callback while held
});

await Cache.lock("orders:import", 10).block(5, async () => {
  // wait up to 5s for the lock
});
```

`Cache.flushLocks()` forgets lock keys this process created via `lock()`.

### Concurrency funnel

`Cache.funnel(name)` limits how many concurrent executions may hold a named resource:

```ts
await Cache.funnel("imports")
  .limit(3)
  .releaseAfter(60)
  .block(10)
  .then(
    async () => {
      // slot acquired
    },
    async () => {
      // timed out — optional failure callback
    },
  );
```

### Failover stores

Configure a store with `driver: "failover"` and a list of store names. The first store that succeeds handles the call; later stores are used only when an earlier one throws:

```ts
stores: {
  primary: { driver: "redis" },
  backup: { driver: "file" },
  resilient: {
    driver: "failover",
    stores: ["primary", "backup"],
  },
},
```

### Cache events

Set `events: true` in `config/cache.ts` to dispatch `CacheHit`, `CacheMissed`, `KeyWritten`, `KeyForgotten`, and `CacheFlushed` through the event dispatcher when `@bunyad/events` is available. Or call `setCacheEventsEnabled(true)` and `setCacheEventDispatcher` yourself.

`touch` refreshes the TTL of an existing key. Pass seconds or a `Date`. A non-positive TTL forgets the key. Returns `false` when the key was missing.

```ts
await Cache.touch("key", 120);
await Cache.touch("key", new Date(Date.now() + 60_000));
```

`getSeconds` converts a number or `Date` to whole seconds for APIs that still take a number:

```ts
await Cache.put("key", "value", Cache.getSeconds(new Date(Date.now() + 60_000)));
```

### Remember

`remember` returns the cached value, or runs the callback, stores the result, and returns it. `rememberForever` / `sear` never expire. `rememberWithWarmth` returns `[value, wasWarm]` where `wasWarm` is `true` when the value was already in the cache.

```ts
const users = await Cache.remember("users", 60, async () => {
  return loadUsers();
});

const forever = await Cache.rememberForever("settings", () => loadSettings());
```

### Flexible (stale while revalidate)

`flexible` takes a fresh window and a total lifetime. While the value is still fresh, it is returned as usual. After the fresh window and before the total expiry, the stale value is returned immediately and a background refresh runs once:

```ts
const report = await Cache.flexible(
  "daily-report",
  [300, 3600],
  () => buildReport(),
);
```

`[300, 3600]` means five minutes fresh and one hour total. Each entry may be a number of seconds or a `Date`.

## Removing items

```ts
await Cache.forget("key");
await Cache.delete("key");
await Cache.deleteMultiple(["a", "b"]);
await Cache.flush();
await Cache.clear();
```

`forget` / `delete` return whether a key was removed. `flush` / `clear` wipe the whole store. On Redis that includes every key under the store prefix. Do not flush a shared Redis database used by other applications.

## Memoization

`Cache.memo()` wraps a store with a request-scoped memory layer. The first `get` for a key hits the store. Later `get` calls in the same process reuse the in-memory copy until you mutate that key or call `Cache.flushMemo()`.

```ts
await Cache.memo().get("key");
await Cache.memo().get("key");

await Cache.memo("redis").get("key");
Cache.flushMemo();
```

Pass a store name when that store is registered. Call `flushMemo` at the end of a request or job so the next unit of work starts clean.

## The cache helper

`cache()` returns the default repository. In a framework app it is also available as a global:

```ts
import { cache } from "@bunyad/cache";

await cache().get("key");
await cache().put("key", "value", 60);
```

## Cache tags

`tags` namespaces keys and lets you flush a group:

```ts
await Cache.tags(["people", "authors"]).put("Ada", ada, 600);
const ada = await Cache.tags(["people", "authors"]).get("Ada");

await Cache.tags(["people"]).flush();
```

Tagged keys are stored as `tagged:authors|people:Ada` (tag names sorted). Flushing a tag deletes every key tracked under that tag. Tag lists are kept in the same store, so every driver that implements `get` / `put` / `forever` / `forget` can use tags.

## Testing

`Cache.fake()` swaps the default repository for an in-memory fake. Assert, then `restore`:

```ts
import { Cache } from "@bunyad/cache";

Cache.fake();

await Cache.put("key", "value");

await Cache.assertHas("key");
await Cache.assertHasValue("key", "value");
await Cache.assertMissing("other");

Cache.restore();
```

## Custom stores

Any object that implements the `CacheStore` contract can back a repository. Register it with `setCache` or `setCacheStore`, or pass it to `Cache.setStore` on the default repository:

```ts
import type { CacheStore } from "@bunyad/contracts";
import { CacheRepository, setCache } from "@bunyad/cache";

class LoggingStore implements CacheStore {
  async get<T>(key: string): Promise<T | undefined> {
    return undefined;
  }

  async put(key: string, value: unknown, seconds?: number): Promise<void> {}

  async forever(key: string, value: unknown): Promise<void> {
    await this.put(key, value);
  }

  async forget(key: string): Promise<boolean> {
    return false;
  }

  async flush(): Promise<void> {}

  async has(key: string): Promise<boolean> {
    return false;
  }

  async increment(key: string, value = 1): Promise<number> {
    return value;
  }

  async decrement(key: string, value = 1): Promise<number> {
    return -value;
  }
}

setCache(new CacheRepository(new LoggingStore()));
```
