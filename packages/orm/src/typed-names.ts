/**
 * Editor-hint types: relation and column names for a model, with a `string`
 * fallback so dynamic names, `rel as alias`, nested `a.b` paths and
 * `table.column` keep compiling. Typos still run; the editor just suggests
 * the real names first.
 */
import type {
  BelongsTo,
  BelongsToMany,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  MorphMany,
  MorphOne,
  MorphTo,
  MorphToMany,
  MorphedByMany,
} from "./relations.ts";
import type { Model } from "./model.ts";
import type { ModelQuery } from "./model-query.ts";

type AnyRelation =
  | BelongsTo<any>
  | BelongsToMany<any>
  | HasMany<any>
  | HasManyThrough<any>
  | HasOne<any>
  | HasOneThrough<any>
  | MorphMany<any>
  | MorphOne<any>
  | MorphTo
  | MorphToMany<any>
  | MorphedByMany<any>;

/** Methods on the model that return a relation (`posts()`, `author()`, …). */
export type RelationNames<T> = {
  [K in Exclude<keyof T, keyof Model> & string]: T[K] extends () => AnyRelation
    ? K
    : never;
}[Exclude<keyof T, keyof Model> & string];

/** Members `Model` itself declares that are really columns (every table has `id`). */
type ModelOwnKeys = Exclude<keyof Model, "id">;

/** Declared data fields on the model (`declare title: string`), excluding methods, plus the timestamp columns. */
export type ColumnNames<T> =
  | {
      [K in Exclude<keyof T, ModelOwnKeys> & string]: T[K] extends (...args: any[]) => unknown
        ? never
        : K;
    }[Exclude<keyof T, ModelOwnKeys> & string]
  | "created_at"
  | "updated_at"
  | "deleted_at";

/** Suggest `K` in the editor but accept any string. */
export type Hint<K extends string> = K | (string & {});

export type RelationHint<T> = Hint<RelationNames<T>>;
export type ColumnHint<T> = Hint<ColumnNames<T>>;

// ── Strict names (opt-in): `strict(User).with("psots")` does not compile ──────────

/** A relation method, optionally with a nested path (`posts.comments`) or an alias (`posts as p`). */
export type StrictRelation<T> =
  | RelationNames<T>
  | `${RelationNames<T>}.${string}`
  | `${RelationNames<T>} as ${string}`;

/** A declared field, or a qualified `table.column`. */
export type StrictColumn<T> = ColumnNames<T> | `${string}.${string}`;

/** `with({ comments: (q) => q.where(...) })` — keys are checked like the string form. */
export type StrictWithMap<T> = {
  [K in StrictRelation<T>]?: true | string | { as?: string } | ((query: ModelQuery) => void);
};

type StrictOverridden =
  | "with" | "has" | "doesntHave" | "whereHas" | "orWhereHas" | "whereDoesntHave" | "withWhereHas"
  | "where" | "whereIn" | "whereNull" | "whereNotNull" | "orderBy" | "orderByDesc";

/**
 * A model query whose relation and column names are checked. Methods that are not
 * listed here keep their normal (lenient) types and return a plain `ModelQuery`.
 */
export interface StrictQuery<T extends Model> extends Omit<ModelQuery<T>, StrictOverridden> {
  with(...relations: Array<StrictRelation<T> | StrictRelation<T>[] | StrictWithMap<T>>): StrictQuery<T>;
  has(relation: StrictRelation<T>): StrictQuery<T>;
  doesntHave(relation: StrictRelation<T>): StrictQuery<T>;
  whereHas(relation: StrictRelation<T>, callback?: (query: ModelQuery) => void): StrictQuery<T>;
  orWhereHas(relation: StrictRelation<T>, callback?: (query: ModelQuery) => void): StrictQuery<T>;
  whereDoesntHave(relation: StrictRelation<T>, callback?: (query: ModelQuery) => void): StrictQuery<T>;
  withWhereHas(relation: StrictRelation<T>, callback?: (query: ModelQuery) => void): StrictQuery<T>;
  where(callback: (query: ModelQuery<T>) => void): StrictQuery<T>;
  where(column: StrictColumn<T>, value: unknown): StrictQuery<T>;
  where(column: StrictColumn<T>, op: string, value: unknown): StrictQuery<T>;
  whereIn(column: StrictColumn<T>, values: unknown[]): StrictQuery<T>;
  whereNull(column: StrictColumn<T>): StrictQuery<T>;
  whereNotNull(column: StrictColumn<T>): StrictQuery<T>;
  orderBy(column: StrictColumn<T>, direction?: "asc" | "desc"): StrictQuery<T>;
  orderByDesc(column: StrictColumn<T>): StrictQuery<T>;
}

/** A model class whose query-starting methods return a {@link StrictQuery}. */
export type StrictModel<M extends typeof Model> = Omit<M, StrictOverridden> & {
  with(...relations: Array<StrictRelation<InstanceType<M>> | StrictRelation<InstanceType<M>>[] | StrictWithMap<InstanceType<M>>>): StrictQuery<InstanceType<M>>;
  has(relation: StrictRelation<InstanceType<M>>): StrictQuery<InstanceType<M>>;
  doesntHave(relation: StrictRelation<InstanceType<M>>): StrictQuery<InstanceType<M>>;
  whereHas(relation: StrictRelation<InstanceType<M>>, callback?: (query: ModelQuery) => void): StrictQuery<InstanceType<M>>;
  where(callback: (query: ModelQuery<InstanceType<M>>) => void): StrictQuery<InstanceType<M>>;
  where(column: StrictColumn<InstanceType<M>>, value: unknown): StrictQuery<InstanceType<M>>;
  where(column: StrictColumn<InstanceType<M>>, op: string, value: unknown): StrictQuery<InstanceType<M>>;
  whereIn(column: StrictColumn<InstanceType<M>>, values: unknown[]): StrictQuery<InstanceType<M>>;
  whereNull(column: StrictColumn<InstanceType<M>>): StrictQuery<InstanceType<M>>;
  whereNotNull(column: StrictColumn<InstanceType<M>>): StrictQuery<InstanceType<M>>;
  orderBy(column: StrictColumn<InstanceType<M>>, direction?: "asc" | "desc"): StrictQuery<InstanceType<M>>;
  orderByDesc(column: StrictColumn<InstanceType<M>>): StrictQuery<InstanceType<M>>;
};

/**
 * Opt-in strict names for one model: relation and column names are checked at compile
 * time. It returns the same class, so there is no runtime cost.
 *
 * ```ts
 * strict(Post).with("author").where("title", "x");   // ok
 * strict(Post).with("autor");                         // compile error
 * ```
 */
export function strict<M extends typeof Model>(model: M): StrictModel<M> {
  return model as unknown as StrictModel<M>;
}

/** Escape hatch for a name only known at run time: `strict(Post).with(unsafeName(input))`. */
export function unsafeName(name: string): never {
  return name as never;
}
