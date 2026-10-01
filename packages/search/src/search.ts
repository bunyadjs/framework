import type {
  Engine,
  SearchableModel,
  SearchDocument,
  SearchConfig,
} from "./types.ts";
import { CollectionEngine } from "./collection-engine.ts";
import { AlgoliaEngine } from "./algolia-engine.ts";
import { MeilisearchEngine } from "./meilisearch-engine.ts";

let config: SearchConfig = {
  driver: "collection",
  prefix: "",
};
const customEngines = new Map<string, () => Engine>();
let engineInstance: Engine | undefined;
let fetchImpl: typeof fetch | undefined;

function resolveDriverName(): string {
  return config.driver ?? process.env.SEARCH_DRIVER ?? process.env.SEARCH_DRIVER ?? "collection";
}

function createEngine(name: string): Engine {
  const custom = customEngines.get(name);
  if (custom) return custom();
  switch (name) {
    case "collection":
    case "null":
      return new CollectionEngine();
    case "algolia":
      return new AlgoliaEngine({
        id: config.algolia?.id,
        secret: config.algolia?.secret,
        fetch: fetchImpl,
      });
    case "meilisearch":
      return new MeilisearchEngine({
        host: config.meilisearch?.host,
        key: config.meilisearch?.key,
        fetch: fetchImpl,
      });
    default:
      throw new Error(
        `Unsupported Search driver [${name}]. Use collection, algolia, meilisearch, or Search.extend().`,
      );
  }
}

/**
 * Search facade — configure driver and resolve the search engine.
 */
export const Search = {
  configure(next: SearchConfig): void {
    config = { ...config, ...next };
    engineInstance = undefined;
  },

  /** Override fetch used by HTTP engines (tests). */
  setFetch(next: typeof fetch | undefined): void {
    fetchImpl = next;
    engineInstance = undefined;
  },

  /** Active engine instance. */
  engine(): Engine {
    if (!engineInstance) {
      engineInstance = createEngine(resolveDriverName());
    }
    return engineInstance;
  },

  driver(name?: string): Engine {
    if (name) {
      return createEngine(name);
    }
    return this.engine();
  },

  /** Register a custom engine factory. */
  extend(name: string, factory: () => Engine): void {
    customEngines.set(name, factory);
  },

  prefix(): string {
    return config.prefix ?? "";
  },

  /** Reset engines/config (tests). */
  flush(): void {
    config = { driver: "collection", prefix: "" };
    customEngines.clear();
    engineInstance = undefined;
    fetchImpl = undefined;
  },
};

export function scoutKey(model: SearchableModel): string {
  const key = model.getSearchKey?.() ?? model.getKey?.() ?? model.id;
  if (key === undefined || key === null) {
    throw new Error("Searchable model must have an id / getSearchKey().");
  }
  return String(key);
}

export function searchableIndex(
  model: SearchableModel,
  modelClass?: { table?: string; searchableAs?: () => string },
): string {
  if (typeof model.searchableAs === "function") {
    return `${Search.prefix()}${model.searchableAs()}`;
  }
  if (modelClass?.searchableAs) {
    return `${Search.prefix()}${modelClass.searchableAs()}`;
  }
  const table =
    modelClass?.table ??
    (typeof model.searchableAs === "string"
      ? model.searchableAs
      : "default");
  return `${Search.prefix()}${table}`;
}

export function toSearchDocument(model: SearchableModel): SearchDocument {
  const data =
    model.toSearchableArray?.() ??
    model.toArray?.() ??
    Object.fromEntries(
      Object.entries(model).filter(
        ([k, v]) => typeof v !== "function" && !k.startsWith("#"),
      ),
    );
  return {
    ...data,
    __scout_key: scoutKey(model),
  };
}
