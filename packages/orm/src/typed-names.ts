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

/** Declared data fields on the model (`declare title: string`), excluding methods. */
export type ColumnNames<T> = {
  [K in Exclude<keyof T, keyof Model> & string]: T[K] extends (...args: any[]) => unknown
    ? never
    : K;
}[Exclude<keyof T, keyof Model> & string];

/** Suggest `K` in the editor but accept any string. */
export type Hint<K extends string> = K | (string & {});

export type RelationHint<T> = Hint<RelationNames<T>>;
export type ColumnHint<T> = Hint<ColumnNames<T>>;
