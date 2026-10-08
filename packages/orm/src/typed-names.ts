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
import type { OrmTypeOptions } from "./index.ts";

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

type StrictNames = OrmTypeOptions extends { strictNames: true } ? true : false;

/**
 * Strict relation name: a relation method, optionally with a nested path
 * (`posts.comments`) or an alias (`posts as p`), so only typos in the first
 * segment are rejected.
 */
type StrictRelation<T> =
  | RelationNames<T>
  | `${RelationNames<T>}.${string}`
  | `${RelationNames<T>} as ${string}`;

/** Strict column name: a declared field, or a qualified `table.column`. */
type StrictColumn<T> = ColumnNames<T> | `${string}.${string}`;

// A query on the bare `Model` type (code that does not know the concrete model, such as the
// ORM itself) cannot be checked, so it stays lenient; concrete models are checked.
export type RelationHint<T> = StrictNames extends true
  ? Model extends T
    ? string
    : StrictRelation<T>
  : Hint<RelationNames<T>>;
export type ColumnHint<T> = StrictNames extends true
  ? Model extends T
    ? string
    : StrictColumn<T>
  : Hint<ColumnNames<T>>;

/** Escape hatch for a name only known at run time: `Post.with(unsafeName(input))`. */
export function unsafeName(name: string): never {
  return name as never;
}

/**
 * The `{ relation: constraint }` form of `with()`. Strict names check the keys like the
 * string form and type the constraint callback; otherwise any record is accepted.
 */
export type WithMap<T> = StrictNames extends true
  ? Model extends T
    ? Record<string, unknown>
    : { [K in StrictRelation<T>]?: true | string | { as?: string } | ((query: ModelQuery) => void) }
  : Record<string, unknown>;
