import {
  Builder,
  makeAllSearchable,
  removeAllFromSearch,
  searchableDelete,
  searchableUpdate,
} from "./builder.ts";
import type { SearchableModel } from "./types.ts";

function resolveKey(model: SearchableModel): string | number {
  if (typeof model.getSearchKey === "function") return model.getSearchKey();
  if (typeof model.getKey === "function") return model.getKey();
  if (model.id === undefined || model.id === null) {
    throw new Error("Searchable model must have an id.");
  }
  return model.id;
}

function resolveIndex(model: SearchableModel): string {
  if (typeof model.searchableAs === "function") return model.searchableAs();
  const table = (model.constructor as { table?: string }).table;
  return table ?? "default";
}

function resolveArray(model: SearchableModel): Record<string, unknown> {
  if (typeof model.toSearchableArray === "function") {
    return model.toSearchableArray();
  }
  if (typeof model.toArray === "function") return model.toArray();
  return Object.fromEntries(
    Object.entries(model).filter(([, v]) => typeof v !== "function"),
  );
}

/**
 * Bound Searchable API for plain model objects (not the mixin).
 */
export class SearchableConcern {
  constructor(readonly model: SearchableModel) {}

  searchableAs(): string {
    return resolveIndex(this.model);
  }

  getSearchKey(): string | number {
    return resolveKey(this.model);
  }

  toSearchableArray(): Record<string, unknown> {
    return resolveArray(this.model);
  }

  async searchable(): Promise<void> {
    const model = this.model;
    await searchableUpdate({
      getSearchKey: () => resolveKey(model),
      searchableAs: () => resolveIndex(model),
      toSearchableArray: () => resolveArray(model),
    });
  }

  async unsearchable(): Promise<void> {
    const model = this.model;
    await searchableDelete({
      getSearchKey: () => resolveKey(model),
      searchableAs: () => resolveIndex(model),
      toSearchableArray: () => resolveArray(model),
    });
  }
}

/** Bind Search helpers to a plain model object. */
export function searchable(model: SearchableModel): SearchableConcern {
  return new SearchableConcern(model);
}

type Constructor = new (...args: any[]) => object;

/**
 * Mixin — `class Post extends Searchable(Model) { ... }`.
 */
export function Searchable<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    static search(this: typeof Base & { table?: string }, query = "") {
      return new Builder(this as never, query);
    }

    static makeAllSearchable(
      this: typeof Base & {
        all?: () => Promise<SearchableModel[]> | SearchableModel[];
      },
    ) {
      return makeAllSearchable(this as never);
    }

    static removeAllFromSearch(this: typeof Base & { table?: string }) {
      return removeAllFromSearch(this as never);
    }

    searchableAs(): string {
      const ctor = this.constructor as {
        searchableAs?: () => string;
        table?: string;
      };
      if (
        Object.hasOwn(ctor, "searchableAs") &&
        typeof ctor.searchableAs === "function"
      ) {
        return ctor.searchableAs();
      }
      return ctor.table ?? "default";
    }

    getSearchKey(): string | number {
      const self = this as unknown as SearchableModel;
      if (self.id === undefined || self.id === null) {
        throw new Error("Searchable model must have an id.");
      }
      return self.id;
    }

    toSearchableArray(): Record<string, unknown> {
      const self = this as unknown as SearchableModel;
      if (typeof self.toArray === "function") return self.toArray();
      return Object.fromEntries(
        Object.entries(self).filter(([, v]) => typeof v !== "function"),
      );
    }

    async searchable(): Promise<void> {
      const self = this;
      await searchableUpdate({
        getSearchKey: () => self.getSearchKey(),
        searchableAs: () => self.searchableAs(),
        toSearchableArray: () => self.toSearchableArray(),
      });
    }

    async unsearchable(): Promise<void> {
      const self = this;
      await searchableDelete({
        getSearchKey: () => self.getSearchKey(),
        searchableAs: () => self.searchableAs(),
        toSearchableArray: () => self.toSearchableArray(),
      });
    }
  };
}
