import { Search, searchableIndex } from "./search.ts";
import type {
  SearchableModel,
  SearchableModelClass,
  SearchDocument,
} from "./types.ts";

/**
 * Fluent Search search builder (`Model.search('q')->where()->get()`).
 */
export class Builder {
  #modelClass: SearchableModelClass;
  #query: string;
  #wheres: Record<string, unknown> = {};
  #whereIns: Record<string, unknown[]> = {};
  #limit: number | null = null;
  #index: string | null = null;

  constructor(modelClass: SearchableModelClass, query = "") {
    this.#modelClass = modelClass;
    this.#query = query;
  }

  /** Constrain to an exact field match. */
  where(field: string, value: unknown): this {
    this.#wheres[field] = value;
    return this;
  }

  /** Constrain field to one of the given values (Laravel Search `whereIn`). */
  whereIn(field: string, values: unknown[]): this {
    this.#whereIns[field] = [...values];
    return this;
  }

  /** Limit result count. */
  take(limit: number): this {
    this.#limit = limit;
    return this;
  }

  /** Alias of `take`. */
  limit(limit: number): this {
    return this.take(limit);
  }

  /** Override index name. */
  within(index: string): this {
    this.#index = index;
    return this;
  }

  async raw(): Promise<{ ids: string[]; hits: SearchDocument[] }> {
    return Search.engine().search({
      index: this.#resolveIndex(),
      query: this.#query,
      wheres: this.#wheres,
      whereIns: this.#whereIns,
      limit: this.#limit,
    });
  }

  async keys(): Promise<string[]> {
    const { ids } = await this.raw();
    return ids;
  }

  async get(): Promise<SearchDocument[]> {
    const { hits } = await this.raw();
    return hits.map(({ __scout_key, ...rest }) => rest as SearchDocument);
  }

  async first(): Promise<SearchDocument | null> {
    const prev = this.#limit;
    this.#limit = 1;
    const rows = await this.get();
    this.#limit = prev;
    return rows[0] ?? null;
  }

  #resolveIndex(): string {
    if (this.#index) return `${Search.prefix()}${this.#index}`;
    if (this.#modelClass.searchableAs) {
      return `${Search.prefix()}${this.#modelClass.searchableAs()}`;
    }
    const table = this.#modelClass.table ?? "default";
    return `${Search.prefix()}${table}`;
  }
}

/** Index helpers used by Searchable mixin / concern. */
export async function searchableUpdate(
  models: SearchableModel | SearchableModel[],
): Promise<void> {
  const list = Array.isArray(models) ? models : [models];
  if (list.length === 0) return;
  await Search.engine().update(list);
}

export async function searchableDelete(
  models: SearchableModel | SearchableModel[],
): Promise<void> {
  const list = Array.isArray(models) ? models : [models];
  if (list.length === 0) return;
  await Search.engine().delete(list);
}

export async function makeAllSearchable(
  modelClass: SearchableModelClass,
): Promise<void> {
  if (typeof modelClass.all !== "function") {
    throw new Error(
      "makeAllSearchable() requires a static all() that returns models.",
    );
  }
  const models = await modelClass.all();
  await searchableUpdate(models);
}

export async function removeAllFromSearch(
  modelClass: SearchableModelClass,
): Promise<void> {
  const index = modelClass.searchableAs
    ? `${Search.prefix()}${modelClass.searchableAs()}`
    : `${Search.prefix()}${modelClass.table ?? "default"}`;
  await Search.engine().flush(index);
}

export { searchableIndex };
