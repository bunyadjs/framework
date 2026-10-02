# @bunyad/cache

A cache repository with memory, file, Redis, database and failover stores, plus tags, atomic locks, a concurrency limiter and a test fake.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/cache@beta
# or: npm install @bunyad/cache@beta
```

## Usage

```ts
import { Cache, CacheRepository, MemoryCacheStore, setCache, cache } from "@bunyad/cache";

setCache(new CacheRepository(new MemoryCacheStore()));

await Cache.put("greeting", "hello", 60);   // TTL in seconds
await Cache.get("greeting");                // "hello"
await Cache.get("missing", "fallback");     // "fallback" (default is not stored)

let runs = 0;
const load = () => cache().remember("users", 60, () => ++runs);
await load(); await load();                 // runs === 1 (callback ran once)

await Cache.tags(["people"]).put("ada", { name: "Ada" }, 60);
await Cache.tags(["people"]).flush();
await Cache.tags(["people"]).get("ada");    // undefined

await Cache.increment("hits");              // 1
await Cache.increment("hits", 5);           // 6
```

Other stores: `FileCacheStore({ path })`, `RedisCacheStore({ url, prefix })`, `DatabaseCacheStore`, `FailoverCacheStore`. Named stores: `setCacheStore("name", repo)` then `Cache.store("name")`. Also `lock()`, `funnel()`, `Cache.fake()` for tests (returns a `CacheFake`), and cache events (`CacheHit`, `CacheMissed`, ...).

## Notes

- Bun only (Bun 1.4 or newer).
- `RedisCacheStore` uses Bun's built-in `RedisClient`; no extra driver is needed. Default key prefix is `bunyad:`.
- No optional peer dependencies. Depends on `@bunyad/contracts`.

## License

MIT
