import { ServiceProvider } from "@bunyad/core";
import type { Connection } from "@bunyad/database";
import { DB } from "@bunyad/database";
import type { CacheStore } from "@bunyad/contracts";
import {
  MemoryCacheStore,
  FileCacheStore,
  RedisCacheStore,
  DatabaseCacheStore,
  FailoverCacheStore,
  CacheRepository,
  setCache,
  setCacheStore,
  setCacheStoreFactory,
  Cache,
  setCacheEventsEnabled,
  setCacheEventDispatcher,
} from "@bunyad/cache";
import { setScheduleMutexStore } from "@bunyad/schedule";
import { resolveRedisUrl } from "./database-config.ts";

export type CacheStoreConfig = {
  driver?: string;
  path?: string;
  url?: string;
  /** Redis or database connection name. */
  connection?: string;
  /** Database cache table (default `cache`). */
  table?: string;
  /** Key prefix for database / redis stores. */
  prefix?: string;
  /** Store names to try in order (`driver: "failover"`). */
  stores?: string[];
  /** Fire hit/miss/write events for this store (default: config `events`). */
  events?: boolean;
};

export type CacheConfig = {
  default?: string;
  /** When true, dispatch CacheHit / CacheMissed / KeyWritten events. */
  events?: boolean;
  stores?: Record<string, CacheStoreConfig>;
};

function createCacheStore(
  app: ServiceProvider["app"],
  name: string,
  storeConfig: CacheStoreConfig,
  allStores: Record<string, CacheStoreConfig>,
  resolving: Set<string> = new Set(),
): CacheStore {
  const driver = storeConfig.driver ?? name;

  if (driver === "failover") {
    const names = storeConfig.stores ?? [];
    if (names.length === 0) {
      throw new Error(
        `Cache store [${name}] failover driver requires a non-empty stores list.`,
      );
    }
    if (resolving.has(name)) {
      throw new Error(`Cache store [${name}] has a circular failover reference.`);
    }
    resolving.add(name);
    const stores = names.map((childName) => {
      const child = allStores[childName];
      if (!child) {
        throw new Error(
          `Cache failover store [${name}] references unknown store [${childName}].`,
        );
      }
      return createCacheStore(app, childName, child, allStores, resolving);
    });
    resolving.delete(name);
    return new FailoverCacheStore(stores);
  }

  if (driver === "file") {
    return new FileCacheStore({
      path: storeConfig.path ?? app.storagePath("framework/cache"),
    });
  }

  if (driver === "redis") {
    return new RedisCacheStore({
      url:
        storeConfig.url ??
        resolveRedisUrl(app, storeConfig.connection ?? "cache") ??
        process.env.REDIS_URL,
      prefix: storeConfig.prefix,
    });
  }

  if (driver === "database") {
    const connectionName = storeConfig.connection;
    const connection = connectionName
      ? (DB.connection(connectionName) as Connection)
      : app.make<Connection>("db");
    return new DatabaseCacheStore({
      connection,
      table: storeConfig.table ?? "cache",
      prefix: storeConfig.prefix ?? "",
    });
  }

  // memory / array / unknown → in-process map
  return new MemoryCacheStore();
}

/**
 * Registers the default cache repository and every named store from
 * `config/cache.ts` so `Cache.store('redis')` resolves without manual wiring.
 * Non-default stores are built lazily on first `Cache.store(name)`.
 */
export class CacheServiceProvider extends ServiceProvider {
  register(): void {
    const config = this.app.config.get<CacheConfig>("cache") ?? {};
    const stores = config.stores ?? {};
    const defaultName =
      config.default ?? process.env.CACHE_DRIVER ?? "memory";

    if (config.events) {
      setCacheEventsEnabled(true);
      try {
        // Soft dependency — Event may not be booted yet in minimal apps.
        const { Event } = require("@bunyad/events") as typeof import("@bunyad/events");
        setCacheEventDispatcher({
          dispatch: (event) => Event.dispatch(event),
        });
      } catch {
        // Events package unavailable; keep events enabled for a custom dispatcher.
      }
    }

    for (const [name, storeConfig] of Object.entries(stores)) {
      if (name === defaultName) continue;
      setCacheStoreFactory(name, () =>
        new CacheRepository(
          createCacheStore(this.app, name, storeConfig ?? {}, stores),
          { store: name },
        ),
      );
    }

    const defaultConfig = stores[defaultName] ?? { driver: defaultName };
    const defaultRepo = new CacheRepository(
      createCacheStore(this.app, defaultName, defaultConfig, stores),
      { store: defaultName },
    );
    setCacheStore(defaultName, defaultRepo);
    setCache(defaultRepo);
    this.app.instance("cache", defaultRepo);

    setScheduleMutexStore({
      add: (key, seconds) => Cache.add(key, 1, seconds),
      forget: (key) => Cache.forget(key),
    });
  }
}
