/** Document stored in a Search index. */
export type SearchDocument = Record<string, unknown> & {
  __scout_key?: string;
};

/** Model / record that can be indexed. */
export type SearchableModel = {
  id?: string | number;
  getKey?: () => string | number;
  getSearchKey?(): string | number;
  toSearchableArray?(): Record<string, unknown>;
  searchableAs?(): string;
  toArray?: () => Record<string, unknown>;
  [key: string]: unknown;
};

export type SearchableModelClass = {
  new (...args: any[]): object;
  table?: string;
  searchableAs?: () => string;
  /** Optional — used by `makeAllSearchable()`. */
  all?: () => Promise<SearchableModel[]> | SearchableModel[];
  search?: (query?: string) => BuilderLike;
};

export type BuilderLike = {
  get(): Promise<SearchDocument[]>;
  first(): Promise<SearchDocument | null>;
  take(limit: number): BuilderLike;
  where(field: string, value: unknown): BuilderLike;
  whereIn(field: string, values: unknown[]): BuilderLike;
  raw(): Promise<{ ids: string[]; hits: SearchDocument[] }>;
};

export type EngineSearchBuilder = {
  index: string;
  query: string;
  wheres: Record<string, unknown>;
  whereIns: Record<string, unknown[]>;
  limit: number | null;
};

export type Engine = {
  update(models: SearchableModel[]): Promise<void>;
  delete(models: SearchableModel[]): Promise<void>;
  search(builder: EngineSearchBuilder): Promise<{ ids: string[]; hits: SearchDocument[] }>;
  flush(index: string): Promise<void>;
};

export type SearchConfig = {
  driver?: string;
  prefix?: string;
  algolia?: {
    id?: string;
    secret?: string;
  };
  meilisearch?: {
    host?: string;
    key?: string;
  };
};
