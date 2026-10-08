/**
 * Fluent query builder returned by Model.query() / newQuery().
 */
import type { Connection, DateInput, QueryBuilder } from "@bunyad/database";
import {
  DatabaseManager as Db,
  CursorPaginator,
  LengthAwarePaginator,
  Paginator,
  dateTimeForStorage,
  hasQueryListeners,
  resolvePaginatorPage,
  wrapSqlName,
} from "@bunyad/database";
import { Collection, LazyCollection } from "@bunyad/common";
import { OrmCollection } from "./orm-collection.ts";
import {
  bootIfNotBooted,
  fireModelEvent,
  hasModelEventListeners,
} from "./model-events.ts";
import {
  getGlobalScopes,
  hasGlobalScopes,
  type GlobalScopeCallback,
} from "./scopes.ts";
import { resolveModelBuilder } from "./decorators.ts";
import {
  deletedAtColumn,
  normalizeWithRelations,
  nowForConnection,
  parseRelationAlias,
  singular,
  usesSoftDeletes,
  type NormalizedEagerRelation,
} from "./model-helpers.ts";
import {
  BelongsTo,
  BelongsToMany,
  HasMany,
  HasManyThrough,
  HasOne,
  MorphMany,
  MorphOne,
  MorphTo,
  MorphToMany,
  morphTypeFor,
  resolveRelation,
  resolveAggregateRelation,
  applyPivotWheres,
  type AggregateRelationMeta,
  type RelationMeta,
} from "./relations.ts";
import { eagerLoadAggregates, eagerLoadModels } from "./eager.ts";
import type { ColumnHint, RelationHint, WithMap } from "./typed-names.ts";
import { type CastDefinition } from "./casts.ts";
import {
  Model,
  ModelNotFoundException,
  attributesNeedModelCasts,
  filterFillable,
  resolveConnection,
  type ModelClass,
  type ModelQueryOptions,
} from "./model.ts";

/**
 * Local-scope Proxy exposes this so callers can reach the real `ModelQuery`
 * (private fields are not accessible through a Proxy).
 */
export const MODEL_QUERY_TARGET = Symbol.for("bunyad.orm.ModelQuery.target");

/** Unwrap a local-scope Proxy to the underlying `ModelQuery` instance. */
export function unwrapModelQuery<Q extends ModelQuery>(query: Q): Q {
  const target = (query as unknown as Record<symbol, Q | undefined>)[
    MODEL_QUERY_TARGET
  ];
  return target ?? query;
}

/** Shared empty array — copy-on-write before mutate (ModelQuery ctor hot path). */
/** Relations accepted by `withCount` / `withSum` / …: names, lists, or constraint maps. */
export type AggregateRelations =
  | string
  | AggregateRelations[]
  | Record<
      string,
      true | string | { as?: string } | ((query: ModelQuery) => void)
    >;

/** `whereNot('col', v)` / `whereNot('col', op, v)` become a negated one-condition group. */
function notGroupCallback<T extends Model>(
  callbackOrColumn: ((query: ModelQuery<T>) => void) | string,
  opOrValue?: unknown,
  value?: unknown,
): (query: ModelQuery<T>) => void {
  if (typeof callbackOrColumn === "function") return callbackOrColumn;
  return (q) => {
    if (value === undefined) (q as ModelQuery<any>).where(callbackOrColumn, opOrValue);
    else (q as ModelQuery<any>).where(callbackOrColumn, String(opOrValue), value);
  };
}

/** A subquery: a query builder, a model query, or a closure that configures a builder. */
export type SubQuery = QueryBuilder | ModelQuery<any, any> | ((q: QueryBuilder) => void);

const MQ_EMPTY: never[] = Object.freeze([]) as unknown as never[];
const MQ_EMPTY_OBJ: Record<string, never> = Object.freeze({}) as Record<string, never>;

/** Copy-on-write: return a mutable array (clone shared MQ_EMPTY). */
function mqMut<T>(arr: T[]): T[] {
  return arr === (MQ_EMPTY as unknown as T[]) ? [] : arr;
}

function mqMutObj<T extends Record<string, unknown>>(obj: T): T {
  return obj === (MQ_EMPTY_OBJ as unknown as T) ? ({} as T) : obj;
}

/** Compiled simple-SELECT SQL keyed by constraint fingerprint (per model). */
const simpleSelectSqlCache = new WeakMap<ModelClass, Map<string, string>>();
/** Compiled parent+EXISTS SELECT SQL (whereHas fast path). */
const hasExistsSelectSqlCache = new WeakMap<ModelClass, Map<string, string>>();

const SIMPLE_WHERE_OPS = new Set([
  "=",
  "!=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "like",
  "LIKE",
  "not like",
  "NOT LIKE",
  "__null__",
  "__notnull__",
]);

function wheresAreSimple(wheres: Array<{ op: string }>): boolean {
  for (const where of wheres) {
    if (!SIMPLE_WHERE_OPS.has(where.op)) return false;
  }
  return true;
}

/** `id`, `name`, `categories.id`, or `*`. Expressions stay on the full builder. */
function plainColumnList(columns: string[]): string | null {
  if (columns.length === 0) return "*";
  for (const column of columns) {
    if (
      column !== "*" &&
      !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(column)
    ) {
      return null;
    }
  }
  return columns.join(", ");
}

export class ModelQuery<
  T extends Model = Model,
  TResult extends "model" | "row" = "model",
> {
  #wheres: Array<{
    column: string;
    op: string;
    value: unknown;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereIns: Array<{
    column: string;
    values: unknown[];
    not: boolean;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereNulls: Array<{
    column: string;
    not: boolean;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereBetweens: Array<{
    column: string;
    values: [unknown, unknown];
    not: boolean;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereColumns: Array<{
    first: string;
    op: string;
    second: string;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereRaws: Array<{
    sql: string;
    bindings: unknown[];
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #whereLikes: Array<{
    column: string;
    value: string;
    not: boolean;
    caseSensitive: boolean;
    boolean: "and" | "or";
  }> = MQ_EMPTY as any;
  #dateWheres: Array<{
    column: string;
    op: string;
    value: DateInput | string;
    kind: "date" | "year" | "month" | "day";
  }> = MQ_EMPTY as any;
  #orders: Array<
    | { column: string; direction: "asc" | "desc" }
    | { raw: string }
  > = MQ_EMPTY as any;
  #selectColumns: string[] | null = null;
  #addSelectColumns: string[] = MQ_EMPTY as any;
  #selectRaws: Array<{ expression: string; bindings: unknown[] }> = MQ_EMPTY as any;
  #distinct = false;
  #limitValue?: number;
  #offsetValue?: number;
  #groupByColumns: string[] = MQ_EMPTY as any;
  #havings: Array<{ column: string; op: string; value: unknown }> = MQ_EMPTY as any;
  #havingRaws: Array<{ sql: string; bindings: unknown[] }> = MQ_EMPTY as any;
  #lock: false | "update" | "share" = false;
  #hasConstraints: Array<{
    relation: string;
    not: boolean;
    or: boolean;
    /** Kept for clone/debug; prefer relatedQuery when set. */
    callback?: (query: ModelQuery) => void;
    /** Resolved once at whereHas call time. */
    meta?: RelationMeta;
    /**
     * Related ModelQuery after call-time callback (flat or nested).
     * Reused across builds — no per-get newQuery/callback.
     */
    relatedQuery?: ModelQuery;
    /** Pre-bound EXISTS body (has / belongsToMany / morphToMany). */
    applyExists?: (sub: QueryBuilder) => void;
    /** Compiled EXISTS/IN subquery (call-time); skips sub-QB on each build. */
    existsSql?: string;
    existsBindings?: unknown[];
    /**
     * When set, emit `inColumn IN (existsSql)` instead of correlated EXISTS.
     * BelongsToMany/MorphToMany SQLite fast path (avoids parent SCAN + pivot SCAN).
     */
    inColumn?: string;
  }> = MQ_EMPTY as any;
  #withCounts: string[] = MQ_EMPTY as any;
  #withAggregates: Array<{
    relation: string;
    alias: string;
    fn: "count" | "sum" | "avg" | "min" | "max" | "exists";
    column?: string;
    constraint?: (query: ModelQuery) => void;
  }> = MQ_EMPTY as any;
  #morphHasConstraints: Array<{
    typeColumn: string;
    idColumn: string;
    types: ModelClass[];
    not: boolean;
    or: boolean;
    callback?: (query: ModelQuery) => void;
  }> = MQ_EMPTY as any;
  #builderExtras: Array<(q: QueryBuilder) => void> = MQ_EMPTY as any;
  #nestedGroups: Array<{
    boolean: "and" | "or";
    not: boolean;
    /** Polymorphic nesting — concrete `T` is erased when applying constraints. */
    callback: (query: ModelQuery<any>) => void;
  }> = MQ_EMPTY as any;
  #joins: Array<{
    type: "inner" | "left" | "right";
    table: string;
    first: string;
    op: string;
    second: string;
  }> = MQ_EMPTY as any;
  #withTrashed: boolean;
  #onlyTrashed: boolean;
  /**
   * True when this query is only applied inside a WHERE nested group
   * (`where(callback)`). BelongsTo whereHas must not expand to JOIN.
   */
  #nestedWhereGroup: boolean;
  /** Pending attrs from `withAttributes` — merged into create + optional wheres. */
  #pendingAttributes: Record<string, unknown> = MQ_EMPTY_OBJ as Record<string, unknown>;
  #eagerLoad: NormalizedEagerRelation[];
  #casts: Record<string, CastDefinition> = MQ_EMPTY_OBJ as Record<string, CastDefinition>;
  /** True once `withCasts` adds any query-time cast (avoid per-row key scan). */
  #hasQueryCasts = false;
  /**
   * False once a constraint needs the full QueryBuilder
   * (joins, nested wheres, raws, has/whereRelation, …).
   */
  #simple = true;
  /** Cached `retrieved` listener presence (hydrate hot path). */
  #hasRetrievedListeners = false;
  #withoutGlobalScopes?: true | Set<string>;
  #connection?: string | Connection;
  /** When true, `get()` returns plain row objects instead of models. */
  #asRows = false;

  constructor(
    private model: ModelClass,
    options: ModelQueryOptions = {},
  ) {
    bootIfNotBooted(model);
    this.#hasRetrievedListeners = hasModelEventListeners(model, "retrieved");
    this.#withTrashed = options.withTrashed ?? false;
    this.#onlyTrashed = options.onlyTrashed ?? false;
    this.#nestedWhereGroup = options.nestedWhereGroup ?? false;
    this.#eagerLoad = options.eagerLoad ?? (MQ_EMPTY as unknown as NormalizedEagerRelation[]);
    this.#connection = options.connection;
    if (options.withoutGlobalScopes === true) {
      this.#withoutGlobalScopes = true;
    } else if (Array.isArray(options.withoutGlobalScopes)) {
      this.#withoutGlobalScopes = new Set(options.withoutGlobalScopes);
    }
  }

  /** Query builder bound to this query's connection (or the model default). */
  #baseTable(): QueryBuilder {
    if (this.#connection !== undefined) {
      return new Db(resolveConnection(this.#connection)).table(this.model.table);
    }
    return this.model.db().table(this.model.table);
  }

  /** `get()` returns plain row objects. Models are not built. */
  rows(): ModelQuery<T, "row"> {
    this.#asRows = true;
    return this as unknown as ModelQuery<T, "row">;
  }

  /** `withoutGlobalScopes`. */
  withoutGlobalScopes(names?: string[]): this {
    if (!names) this.#withoutGlobalScopes = true;
    else {
      const set =
        this.#withoutGlobalScopes === true || this.#withoutGlobalScopes == null
          ? new Set<string>()
          : this.#withoutGlobalScopes;
      for (const name of names) set.add(name);
      this.#withoutGlobalScopes = set;
    }
    return this;
  }

  /** `withoutGlobalScope`. */
  withoutGlobalScope(name: string): this {
    return this.withoutGlobalScopes([name]);
  }

  /** `withTrashed()`. */
  withTrashed(): this {
    this.#withTrashed = true;
    this.#onlyTrashed = false;
    return this;
  }

  /** `onlyTrashed()`. */
  onlyTrashed(): this {
    this.#onlyTrashed = true;
    this.#withTrashed = false;
    return this;
  }

  /** `withoutTrashed()`. */
  withoutTrashed(): this {
    this.#withTrashed = false;
    this.#onlyTrashed = false;
    return this;
  }

  /**
   * `Builder::withAttributes` — pending attrs for `create()`, and
   * matching `where` conditions when `asConditions` is true (default).
   */
  withAttributes(
    attributes: Record<string, unknown> | string,
    valueOrAsConditions?: unknown,
    asConditions = true,
  ): this {
    let attrs: Record<string, unknown>;
    let applyAsConditions = asConditions;
    if (typeof attributes === "string") {
      attrs = { [attributes]: valueOrAsConditions };
    } else {
      attrs = { ...attributes };
      // `withAttributes({ hidden: 1 }, false)` — second arg is asConditions
      if (typeof valueOrAsConditions === "boolean") {
        applyAsConditions = valueOrAsConditions;
      }
    }
    this.#pendingAttributes = mqMutObj(this.#pendingAttributes);
    Object.assign(this.#pendingAttributes, attrs);
    if (applyAsConditions) {
      for (const [column, v] of Object.entries(attrs)) {
        (this as ModelQuery<any>).where(column, v);
      }
    }
    return this;
  }

  /** `withCasts` — merge query-time casts for hydration. */
  withCasts(casts: Record<string, CastDefinition>): this {
    this.#casts = mqMutObj(this.#casts);
    Object.assign(this.#casts, casts);
    for (const _ in casts) {
      this.#hasQueryCasts = true;
      break;
    }
    return this;
  }

  /** `has`. */
  has(relation: RelationHint<T>): this {
    return this.whereHas(relation);
  }

  /** `doesntHave`. */
  doesntHave(relation: RelationHint<T>): this {
    return this.whereDoesntHave(relation);
  }

  /** `whereHas`. */
  whereHas(
    relation: RelationHint<T>,
    callback?: (query: ModelQuery) => void,
  ): this {
    this.#simple = false;
    // BelongsTo AND: expand to INNER JOIN once (same SQL as join()), avoid re-resolve per get().
    // Nested where groups only emit WHERE SQL — JOIN expand would reference related columns
    // without a FROM entry ("missing FROM-clause entry for table …").
    const meta = resolveRelation(this.model, relation);
    if (meta?.kind === "belongsTo" && !this.#nestedWhereGroup) {
      this.#expandBelongsToHasJoin(meta, callback, relation);
      return this;
    }
    return this.#pushHasConstraint(relation, false, false, callback, meta);
  }

  /** `orWhereHas`. */
  orWhereHas(
    relation: RelationHint<T>,
    callback?: (query: ModelQuery) => void,
  ): this {
    this.#simple = false;
    return this.#pushHasConstraint(relation, false, true, callback);
  }

  /** `whereDoesntHave`. */
  whereDoesntHave(
    relation: RelationHint<T>,
    callback?: (query: ModelQuery) => void,
  ): this {
    this.#simple = false;
    return this.#pushHasConstraint(relation, true, false, callback);
  }

  /** `orWhereDoesntHave`. */
  orWhereDoesntHave(
    relation: string,
    callback?: (query: ModelQuery) => void,
  ): this {
    this.#simple = false;
    return this.#pushHasConstraint(relation, true, true, callback);
  }

  /**
   * `whereRelation($relation, $column, $operator = null, $value = null)`.
   * Convenience wrapper around `whereHas` with a column constraint.
   */
  whereRelation(
    relation: string,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): this {
    this.#simple = false;
    const meta = resolveRelation(this.model, relation);
    // BelongsTo: join + qualified where — same build path as ORM join(), no related ModelQuery.
    // Nested where groups cannot emit JOINs — fall through to has-constraint IN path.
    if (meta?.kind === "belongsTo" && !this.#nestedWhereGroup) {
      const alias = this.#expandBelongsToHasJoin(meta, undefined, relation);
      const col = column.includes(".") ? column : `${alias}.${column}`;
      if (value === undefined) (this as ModelQuery<any>).where(col, opOrValue);
      else (this as ModelQuery<any>).where(col, String(opOrValue), value);
      return this;
    }
    // HasMany / BelongsToMany: bake a single related where into EXISTS (no ModelQuery).
    if (
      meta &&
      (meta.kind === "has" ||
        meta.kind === "belongsToMany" ||
        meta.kind === "morphToMany")
    ) {
      const op = value === undefined ? "=" : String(opOrValue);
      const val = value === undefined ? opOrValue : value;
      return this.#pushHasConstraintWithRelatedApply(
        relation,
        false,
        false,
        meta,
        (sub) => {
          sub.where(column, op, val);
        },
      );
    }
    return (this as any).whereHas(relation, (q: ModelQuery<any>) => {
      if (value === undefined) q.where(column, opOrValue);
      else q.where(column, String(opOrValue), value);
    });
  }

  /** `orWhereRelation`. */
  orWhereRelation(
    relation: string,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): this {
    this.#simple = false;
    const meta = resolveRelation(this.model, relation);
    if (
      meta &&
      (meta.kind === "has" ||
        meta.kind === "belongsToMany" ||
        meta.kind === "morphToMany")
    ) {
      const op = value === undefined ? "=" : String(opOrValue);
      const val = value === undefined ? opOrValue : value;
      return this.#pushHasConstraintWithRelatedApply(
        relation,
        false,
        true,
        meta,
        (sub) => {
          sub.where(column, op, val);
        },
      );
    }
    return (this as any).orWhereHas(relation, (q: ModelQuery<any>) => {
      if (value === undefined) q.where(column, opOrValue);
      else q.where(column, String(opOrValue), value);
    });
  }

  /** `orHas`. */
  orHas(relation: string): this {
    return (this as any).orWhereHas(relation);
  }

  /** `orDoesntHave`. */
  orDoesntHave(relation: string): this {
    return this.orWhereDoesntHave(relation);
  }

  /**
   * `whereBelongsTo($model, $relationshipName = null)`.
   * Constrains by the foreign key of a belongsTo relation.
   */
  whereBelongsTo(related: Model, relationName?: string): this {
    return this.#belongsToConstraint(related, relationName, false);
  }

  /** `orWhereBelongsTo`. */
  orWhereBelongsTo(related: Model, relationName?: string): this {
    return this.#belongsToConstraint(related, relationName, true);
  }

  #belongsToConstraint(
    related: Model,
    relationName: string | undefined,
    or: boolean,
  ): this {
    const RelatedCtor = related.constructor as ModelClass;
    const rel = relationName ?? singular(RelatedCtor.table);
    const meta = resolveRelation(this.model, rel);
    const pkName = meta?.kind === "belongsTo" ? meta.ownerKey : RelatedCtor.primaryKey;
    const fk =
      meta?.kind === "belongsTo"
        ? meta.foreignKey
        : `${singular(RelatedCtor.table)}_id`;
    const pk = (related as unknown as Record<string, unknown>)[pkName];
    if (or) (this as ModelQuery<any>).orWhere(fk, pk);
    else (this as ModelQuery<any>).where(fk, pk);
    return this;
  }

  /**
   * `whereMorphedTo($relation, $model)`.
   */
  whereMorphedTo(relation: string, model: Model): this {
    return this.#morphToConstraint(relation, model, false, false);
  }

  orWhereMorphedTo(relation: string, model: Model): this {
    return this.#morphToConstraint(relation, model, false, true);
  }

  whereNotMorphedTo(relation: string, model: Model): this {
    return this.#morphToConstraint(relation, model, true, false);
  }

  orWhereNotMorphedTo(relation: string, model: Model): this {
    return this.#morphToConstraint(relation, model, true, true);
  }

  #morphToConstraint(
    relation: string,
    model: Model,
    not: boolean,
    or: boolean,
  ): this {
    const instance = new this.model();
    let rel: unknown;
    try {
      rel = instance.related(relation);
    } catch {
      throw new Error(`Unknown morphTo relation [${relation}].`);
    }
    if (!(rel instanceof MorphTo)) {
      throw new Error(`[${relation}] is not a morphTo relation.`);
    }
    const Related = model.constructor as ModelClass;
    const type = morphTypeFor(Related);
    const key = rel.getOwnerKeyName() ?? Related.primaryKey;
    const id = (model as unknown as Record<string, unknown>)[key];
    const typeCol = rel.getTypeColumn();
    const idCol = rel.getIdColumn();
    if (not) {
      // NOT (type = X AND id = Y) → type <> X OR id <> Y
      if (or) {
        // orWhereNot — approximate with orWhereNested not
        (this as ModelQuery<any>).orWhere(typeCol, "!=", type);
        return this;
      }
      return this.whereNot((q) => {
        (q as ModelQuery<any>).where(typeCol, type).where(idCol, id);
      });
    }
    if (or) {
      (this as ModelQuery<any>).orWhere(typeCol, type);
      (this as ModelQuery<any>).where(idCol, id);
      return this;
    }
    (this as ModelQuery<any>).where(typeCol, type);
    (this as ModelQuery<any>).where(idCol, id);
    return this;
  }

  /**
   * `whereMorphRelation($relation, $types, $column, …)` — simplified:
   * `whereMorphRelation('commentable', TypeModel, column, op?, value?)`.
   */
  whereMorphRelation(
    relation: string,
    type: ModelClass,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): this {
    return this.whereHasMorph(relation, type, (q) => {
      if (value === undefined) q.where(column, opOrValue);
      else q.where(column, String(opOrValue), value);
    });
  }

  orWhereMorphRelation(
    relation: string,
    type: ModelClass,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): this {
    return this.orWhereHasMorph(relation, type, (q) => {
      if (value === undefined) q.where(column, opOrValue);
      else q.where(column, String(opOrValue), value);
    });
  }

  /**
   * `whereHasMorph($relation, $types, $callback?)`.
   * `$types` may be a single model class or an array.
   */
  whereHasMorph(
    relation: string,
    types: ModelClass | ModelClass[],
    callback?: (query: ModelQuery) => void,
  ): this {
    return this.#hasMorphConstraint(relation, types, false, false, callback);
  }

  orWhereHasMorph(
    relation: string,
    types: ModelClass | ModelClass[],
    callback?: (query: ModelQuery) => void,
  ): this {
    return this.#hasMorphConstraint(relation, types, false, true, callback);
  }

  whereDoesntHaveMorph(
    relation: string,
    types: ModelClass | ModelClass[],
    callback?: (query: ModelQuery) => void,
  ): this {
    return this.#hasMorphConstraint(relation, types, true, false, callback);
  }

  orWhereDoesntHaveMorph(
    relation: string,
    types: ModelClass | ModelClass[],
    callback?: (query: ModelQuery) => void,
  ): this {
    return this.#hasMorphConstraint(relation, types, true, true, callback);
  }

  hasMorph(
    relation: string,
    types: ModelClass | ModelClass[],
  ): this {
    return this.whereHasMorph(relation, types);
  }

  doesntHaveMorph(
    relation: string,
    types: ModelClass | ModelClass[],
  ): this {
    return this.whereDoesntHaveMorph(relation, types);
  }

  #hasMorphConstraint(
    relation: string,
    types: ModelClass | ModelClass[],
    not: boolean,
    or: boolean,
    callback?: (query: ModelQuery) => void,
  ): this {
    const list = Array.isArray(types) ? types : [types];
    const instance = new this.model();
    let rel: unknown;
    try {
      rel = instance.related(relation);
    } catch {
      throw new Error(`Unknown morphTo relation [${relation}].`);
    }
    if (!(rel instanceof MorphTo)) {
      throw new Error(`[${relation}] is not a morphTo relation.`);
    }
    this.#simple = false;
    (this.#morphHasConstraints = mqMut(this.#morphHasConstraints)).push({
      typeColumn: rel.getTypeColumn(),
      idColumn: rel.getIdColumn(),
      types: list,
      not,
      or,
      callback,
    });
    return this;
  }

  /**
   * `withWhereHas($relation, $callback?)` — whereHas + eager with same constraint.
   */
  withWhereHas(
    relation: RelationHint<T>,
    callback?: (query: ModelQuery) => void,
  ): this {
    this.whereHas(relation, callback);
    this.with(relation);
    return this;
  }

  /** `whereAny` (forwarded to query builder). */
  whereAny(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.whereAny(columns, opOrValue, value));
    return this;
  }

  orWhereAny(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.orWhereAny(columns, opOrValue, value));
    return this;
  }

  whereAll(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.whereAll(columns, opOrValue, value));
    return this;
  }

  orWhereAll(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.orWhereAll(columns, opOrValue, value));
    return this;
  }

  whereNone(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.whereNone(columns, opOrValue, value));
    return this;
  }

  orWhereNone(columns: string[], opOrValue: unknown, value?: unknown): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => q.orWhereNone(columns, opOrValue, value));
    return this;
  }

  /** `whereKey($id)` / `whereKey([$ids])`. */
  whereKey(id: string | number | Array<string | number>): this {
    const key = this.model.primaryKey;
    if (Array.isArray(id)) return (this as any).whereIn(key, id);
    return (this as any).where(key, id);
  }

  /** `whereKeyNot`. */
  whereKeyNot(id: string | number | Array<string | number>): this {
    const key = this.model.primaryKey;
    if (Array.isArray(id)) return this.whereNotIn(key, id);
    return (this as any).where(key, "!=", id);
  }

  /** `whereUuid($column, $uuid)`. */
  whereUuid(column: string, value: string): this {
    return (this as any).where(column, value);
  }

  /** `whereUlid($column, $ulid)`. */
  whereUlid(column: string, value: string): this {
    return (this as any).where(column, value);
  }

  /** `whereNot(closure)` nested group. */
  whereNot(callback: (query: ModelQuery<T>) => void): this;
  whereNot(column: ColumnHint<T>, value: unknown): this;
  whereNot(column: ColumnHint<T>, op: string, value: unknown): this;
  whereNot(
    callbackOrColumn: ((query: ModelQuery<T>) => void) | string,
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    this.#simple = false;
    (this.#nestedGroups = mqMut(this.#nestedGroups)).push({
      boolean: "and",
      not: true,
      callback: notGroupCallback(callbackOrColumn, opOrValue, value),
    });
    return this;
  }

  orWhereNot(callback: (query: ModelQuery<T>) => void): this;
  orWhereNot(column: ColumnHint<T>, value: unknown): this;
  orWhereNot(column: ColumnHint<T>, op: string, value: unknown): this;
  orWhereNot(
    callbackOrColumn: ((query: ModelQuery<T>) => void) | string,
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    this.#simple = false;
    (this.#nestedGroups = mqMut(this.#nestedGroups)).push({
      boolean: "or",
      not: true,
      callback: notGroupCallback(callbackOrColumn, opOrValue, value),
    });
    return this;
  }

  /** `firstWhere`. */
  firstWhere(column: string, value: unknown): T | null | Promise<T | null>;
  firstWhere(
    column: string,
    op: string,
    value: unknown,
  ): T | null | Promise<T | null>;
  firstWhere(
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): T | null | Promise<T | null> {
    if (value === undefined) (this as ModelQuery<any>).where(column, opOrValue);
    else (this as ModelQuery<any>).where(column, String(opOrValue), value);
    return this.first();
  }

  /** `findMany`. */
  findMany(ids: Array<string | number>): OrmCollection<T> | Promise<OrmCollection<T>> {
    return (this as ModelQuery<any>).whereIn(this.model.primaryKey, ids).#fetchModels();
  }

  /** `findOr($id, $callback)`. */
  async findOr(
    id: string | number,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const model = await (this as ModelQuery<any>).where(this.model.primaryKey, id).first();
    if (model) return model;
    return callback();
  }

  /** `findOrNew`. */
  async findOrNew(id: string | number): Promise<T> {
    const model = await (this as ModelQuery<any>).where(this.model.primaryKey, id).first();
    if (model) return model;
    const fresh = new this.model() as T;
    (fresh as unknown as Record<string, unknown>)[this.model.primaryKey] = id;
    return fresh;
  }

  /** `firstOr($callback)`. */
  async firstOr(callback: () => T | Promise<T>): Promise<T> {
    const model = await this.first();
    if (model) return model;
    return callback();
  }

  /** `valueOrFail`. */
  async valueOrFail(column: string): Promise<unknown> {
    const model = await this.firstOrFail();
    return (model as unknown as Record<string, unknown>)[column];
  }

  /** `soleValue`. */
  async soleValue(column: string): Promise<unknown> {
    const model = await this.sole();
    return (model as unknown as Record<string, unknown>)[column];
  }

  #pushAggregate(
    relation: string,
    fn: "count" | "sum" | "avg" | "min" | "max" | "exists",
    column: string | undefined,
    constraint?: (query: ModelQuery) => void,
    alias?: string,
  ): void {
    const parsed = parseRelationAlias(relation);
    const base = parsed.relation;
    const suffix = fn === "count" || fn === "exists" ? fn : `${fn}_${column}`;
    this.#simple = false;
    (this.#withAggregates = mqMut(this.#withAggregates)).push({
      relation: base,
      alias: alias ?? parsed.alias ?? `${base}_${suffix}`,
      fn,
      column: fn === "count" || fn === "exists" ? undefined : column,
      constraint,
    });
  }

  /** `['posts', 'comments as c' => fn]` — string, list, or map of relation → constraint / alias. */
  #pushAggregates(
    specs: ReadonlyArray<AggregateRelations>,
    fn: "count" | "sum" | "avg" | "min" | "max" | "exists",
    column?: string,
  ): void {
    for (const arg of specs) {
      if (Array.isArray(arg)) {
        this.#pushAggregates(arg, fn, column);
        continue;
      }
      if (typeof arg === "string") {
        this.#pushAggregate(arg, fn, column);
        continue;
      }
      for (const [relation, value] of Object.entries(arg)) {
        if (typeof value === "function") {
          this.#pushAggregate(relation, fn, column, value);
        } else if (typeof value === "string") {
          this.#pushAggregate(relation, fn, column, undefined, value);
        } else if (value && typeof value === "object" && value.as) {
          this.#pushAggregate(relation, fn, column, undefined, value.as);
        } else {
          this.#pushAggregate(relation, fn, column);
        }
      }
    }
  }

  /**
   * `withCount` — `'posts'`, `'posts as post_total'`, a list, or a map such as
   * `{ "payments as paid": (q) => q.where("status", "paid") }`.
   */
  withCount(...relations: AggregateRelations[]): this {
    this.#pushAggregates(relations, "count");
    return this;
  }

  /** `withSum($relation, $column)` — relation may be a constrained map. */
  withSum(relation: AggregateRelations, column: string): this {
    this.#pushAggregates([relation], "sum", column);
    return this;
  }

  withAvg(relation: AggregateRelations, column: string): this {
    this.#pushAggregates([relation], "avg", column);
    return this;
  }

  withMin(relation: AggregateRelations, column: string): this {
    this.#pushAggregates([relation], "min", column);
    return this;
  }

  withMax(relation: AggregateRelations, column: string): this {
    this.#pushAggregates([relation], "max", column);
    return this;
  }

  /** `withExists($relation)`. */
  withExists(...relations: AggregateRelations[]): this {
    this.#pushAggregates(relations, "exists");
    return this;
  }

  /** `withAggregate($relation, $column, $function)`. */
  withAggregate(
    relation: AggregateRelations,
    column: string,
    fn: "count" | "sum" | "avg" | "min" | "max",
  ): this {
    this.#pushAggregates([relation], fn, column);
    return this;
  }

  // ── Subqueries, unions and joins on subqueries (forwarded to the query builder) ──

  #sub(query: SubQuery): QueryBuilder | ((q: QueryBuilder) => void) {
    return query instanceof ModelQuery ? query.toBase() : query;
  }

  #extra(apply: (q: QueryBuilder) => void): this {
    this.#simple = false;
    (this.#builderExtras = mqMut(this.#builderExtras)).push(apply);
    return this;
  }

  /** `selectSub($query, $as)` — add a subquery as a selected column. */
  selectSub(query: SubQuery, as: string): this {
    return this.#extra((q) => void q.selectSub(this.#sub(query), as));
  }

  /** `whereExists($query)` and its `or` / `not` variants. */
  whereExists(query: SubQuery): this {
    return this.#extra((q) => void q.whereExists(this.#sub(query)));
  }

  orWhereExists(query: SubQuery): this {
    return this.#extra((q) => void q.orWhereExists(this.#sub(query)));
  }

  whereNotExists(query: SubQuery): this {
    return this.#extra((q) => void q.whereNotExists(this.#sub(query)));
  }

  orWhereNotExists(query: SubQuery): this {
    return this.#extra((q) => void q.orWhereNotExists(this.#sub(query)));
  }

  /** `union` / `unionAll` — the other query must select the same columns. */
  union(query: SubQuery): this {
    return this.#extra((q) => void q.union(this.#sub(query)));
  }

  unionAll(query: SubQuery): this {
    return this.#extra((q) => void q.unionAll(this.#sub(query)));
  }

  /** `joinSub($query, $as, $first, $op, $second)`. */
  joinSub(query: SubQuery, as: string, first: string, op: string, second: string): this {
    return this.#extra((q) => void q.joinSub(this.#sub(query), as, first, op, second));
  }

  leftJoinSub(query: SubQuery, as: string, first: string, op: string, second: string): this {
    return this.#extra((q) => void q.leftJoinSub(this.#sub(query), as, first, op, second));
  }

  rightJoinSub(query: SubQuery, as: string, first: string, op: string, second: string): this {
    return this.#extra((q) => void q.rightJoinSub(this.#sub(query), as, first, op, second));
  }

  /** `crossJoin($table)`. */
  crossJoin(table: string): this {
    return this.#extra((q) => void q.crossJoin(table));
  }

  /** `groupByRaw($sql, $bindings)`. */
  groupByRaw(sql: string, bindings: unknown[] = []): this {
    return this.#extra((q) => void (q as unknown as { groupByRaw(s: string, b: unknown[]): unknown }).groupByRaw(sql, bindings));
  }

  /** `join` (hydrated models still from the base table). */
  join(table: string, first: string, op: string, second: string): this {
    this.#simple = false;
    (this.#joins = mqMut(this.#joins)).push({ type: "inner", table, first, op, second });
    return this;
  }

  /** `leftJoin`. */
  leftJoin(table: string, first: string, op: string, second: string): this {
    this.#simple = false;
    (this.#joins = mqMut(this.#joins)).push({ type: "left", table, first, op, second });
    return this;
  }

  /** `rightJoin`. */
  rightJoin(table: string, first: string, op: string, second: string): this {
    this.#simple = false;
    (this.#joins = mqMut(this.#joins)).push({ type: "right", table, first, op, second });
    return this;
  }

  where(callback: (query: ModelQuery<T>) => void): this;
  where(column: ColumnHint<T>, value: unknown): this;
  where(column: ColumnHint<T>, op: string, value: unknown): this;
  where(
    columnOrCallback: string | ((query: ModelQuery<T>) => void),
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrCallback === "function") {
      this.#simple = false;
      (this.#nestedGroups = mqMut(this.#nestedGroups)).push({
        boolean: "and",
        not: false,
        callback: columnOrCallback,
      });
      return this;
    }
    if (value === undefined) {
      (this.#wheres = mqMut(this.#wheres)).push({
        column: columnOrCallback,
        op: "=",
        value: opOrValue,
        boolean: "and",
      });
    } else {
      const op = String(opOrValue);
      if (
        op !== "=" &&
        op !== "!=" &&
        op !== "<>" &&
        op !== "<" &&
        op !== "<=" &&
        op !== ">" &&
        op !== ">=" &&
        op !== "like" &&
        op !== "LIKE" &&
        op !== "not like" &&
        op !== "NOT LIKE"
      ) {
        this.#simple = false;
      }
      (this.#wheres = mqMut(this.#wheres)).push({
        column: columnOrCallback,
        op,
        value,
        boolean: "and",
      });
    }
    return this;
  }

  orWhere(callback: (query: ModelQuery<T>) => void): this;
  orWhere(column: ColumnHint<T>, value: unknown): this;
  orWhere(column: ColumnHint<T>, op: string, value: unknown): this;
  orWhere(
    columnOrCallback: string | ((query: ModelQuery<T>) => void),
    opOrValue?: unknown,
    value?: unknown,
  ): this {
    if (typeof columnOrCallback === "function") {
      this.#simple = false;
      (this.#nestedGroups = mqMut(this.#nestedGroups)).push({
        boolean: "or",
        not: false,
        callback: columnOrCallback,
      });
      return this;
    }
    if (value === undefined) {
      (this.#wheres = mqMut(this.#wheres)).push({
        column: columnOrCallback,
        op: "=",
        value: opOrValue,
        boolean: "or",
      });
    } else {
      const op = String(opOrValue);
      if (
        op !== "=" &&
        op !== "!=" &&
        op !== "<>" &&
        op !== "<" &&
        op !== "<=" &&
        op !== ">" &&
        op !== ">=" &&
        op !== "like" &&
        op !== "LIKE" &&
        op !== "not like" &&
        op !== "NOT LIKE"
      ) {
        this.#simple = false;
      }
      (this.#wheres = mqMut(this.#wheres)).push({
        column: columnOrCallback,
        op,
        value,
        boolean: "or",
      });
    }
    return this;
  }

  whereIn(column: ColumnHint<T>, values: unknown[]): this {
    this.#simple = false;
    (this.#whereIns = mqMut(this.#whereIns)).push({ column, values, not: false, boolean: "and" });
    return this;
  }

  orWhereIn(column: string, values: unknown[]): this {
    this.#simple = false;
    (this.#whereIns = mqMut(this.#whereIns)).push({ column, values, not: false, boolean: "or" });
    return this;
  }

  whereNotIn(column: string, values: unknown[]): this {
    this.#simple = false;
    (this.#whereIns = mqMut(this.#whereIns)).push({ column, values, not: true, boolean: "and" });
    return this;
  }

  orWhereNotIn(column: string, values: unknown[]): this {
    this.#simple = false;
    (this.#whereIns = mqMut(this.#whereIns)).push({ column, values, not: true, boolean: "or" });
    return this;
  }

  whereNull(column: ColumnHint<T>): this {
    (this.#wheres = mqMut(this.#wheres)).push({
      column,
      op: "__null__",
      value: null,
      boolean: "and",
    });
    return this;
  }

  orWhereNull(column: string): this {
    (this.#wheres = mqMut(this.#wheres)).push({
      column,
      op: "__null__",
      value: null,
      boolean: "or",
    });
    return this;
  }

  whereNotNull(column: ColumnHint<T>): this {
    (this.#wheres = mqMut(this.#wheres)).push({
      column,
      op: "__notnull__",
      value: null,
      boolean: "and",
    });
    return this;
  }

  orWhereNotNull(column: string): this {
    (this.#wheres = mqMut(this.#wheres)).push({
      column,
      op: "__notnull__",
      value: null,
      boolean: "or",
    });
    return this;
  }

  whereBetween(column: string, values: [unknown, unknown]): this {
    this.#simple = false;
    (this.#whereBetweens = mqMut(this.#whereBetweens)).push({
      column,
      values,
      not: false,
      boolean: "and",
    });
    return this;
  }

  orWhereBetween(column: string, values: [unknown, unknown]): this {
    this.#simple = false;
    (this.#whereBetweens = mqMut(this.#whereBetweens)).push({
      column,
      values,
      not: false,
      boolean: "or",
    });
    return this;
  }

  whereNotBetween(column: string, values: [unknown, unknown]): this {
    this.#simple = false;
    (this.#whereBetweens = mqMut(this.#whereBetweens)).push({
      column,
      values,
      not: true,
      boolean: "and",
    });
    return this;
  }

  orWhereNotBetween(column: string, values: [unknown, unknown]): this {
    this.#simple = false;
    (this.#whereBetweens = mqMut(this.#whereBetweens)).push({
      column,
      values,
      not: true,
      boolean: "or",
    });
    return this;
  }

  whereColumn(first: string, second: string): this;
  whereColumn(first: string, op: string, second: string): this;
  whereColumn(first: string, opOrSecond: string, second?: string): this {
    if (second === undefined) {
      this.#simple = false;
      (this.#whereColumns = mqMut(this.#whereColumns)).push({
        first,
        op: "=",
        second: opOrSecond,
        boolean: "and",
      });
    } else {
      this.#simple = false;
      (this.#whereColumns = mqMut(this.#whereColumns)).push({
        first,
        op: opOrSecond,
        second,
        boolean: "and",
      });
    }
    return this;
  }

  orWhereColumn(first: string, second: string): this;
  orWhereColumn(first: string, op: string, second: string): this;
  orWhereColumn(first: string, opOrSecond: string, second?: string): this {
    if (second === undefined) {
      this.#simple = false;
      (this.#whereColumns = mqMut(this.#whereColumns)).push({
        first,
        op: "=",
        second: opOrSecond,
        boolean: "or",
      });
    } else {
      this.#simple = false;
      (this.#whereColumns = mqMut(this.#whereColumns)).push({
        first,
        op: opOrSecond,
        second,
        boolean: "or",
      });
    }
    return this;
  }

  whereRaw(sql: string, bindings: unknown[] = []): this {
    this.#simple = false;
    (this.#whereRaws = mqMut(this.#whereRaws)).push({ sql, bindings, boolean: "and" });
    return this;
  }

  orWhereRaw(sql: string, bindings: unknown[] = []): this {
    this.#simple = false;
    (this.#whereRaws = mqMut(this.#whereRaws)).push({ sql, bindings, boolean: "or" });
    return this;
  }

  whereLike(column: string, value: string, caseSensitive = false): this {
    this.#simple = false;
    (this.#whereLikes = mqMut(this.#whereLikes)).push({
      column,
      value,
      not: false,
      caseSensitive,
      boolean: "and",
    });
    return this;
  }

  orWhereLike(column: string, value: string, caseSensitive = false): this {
    this.#simple = false;
    (this.#whereLikes = mqMut(this.#whereLikes)).push({
      column,
      value,
      not: false,
      caseSensitive,
      boolean: "or",
    });
    return this;
  }

  whereNotLike(column: string, value: string, caseSensitive = false): this {
    this.#simple = false;
    (this.#whereLikes = mqMut(this.#whereLikes)).push({
      column,
      value,
      not: true,
      caseSensitive,
      boolean: "and",
    });
    return this;
  }

  orWhereNotLike(column: string, value: string, caseSensitive = false): this {
    this.#simple = false;
    (this.#whereLikes = mqMut(this.#whereLikes)).push({
      column,
      value,
      not: true,
      caseSensitive,
      boolean: "or",
    });
    return this;
  }

  /** `whereDate` — same on SQLite / Postgres / MySQL. */
  whereDate(column: string, value: DateInput): this;
  whereDate(column: string, op: string, value: DateInput): this;
  whereDate(
    column: string,
    opOrValue: string | DateInput,
    value?: DateInput,
  ): this {
    const op = value === undefined ? "=" : String(opOrValue);
    const raw = (value === undefined ? opOrValue : value) as DateInput;
    this.#simple = false;
    (this.#dateWheres = mqMut(this.#dateWheres)).push({ column, op, value: raw, kind: "date" });
    return this;
  }

  whereYear(column: string, value: number): this {
    this.#simple = false;
    (this.#dateWheres = mqMut(this.#dateWheres)).push({
      column,
      op: "=",
      value: String(value),
      kind: "year",
    });
    return this;
  }

  whereMonth(column: string, value: number): this {
    this.#simple = false;
    (this.#dateWheres = mqMut(this.#dateWheres)).push({
      column,
      op: "=",
      value: String(value),
      kind: "month",
    });
    return this;
  }

  whereDay(column: string, value: number): this {
    this.#simple = false;
    (this.#dateWheres = mqMut(this.#dateWheres)).push({
      column,
      op: "=",
      value: String(value),
      kind: "day",
    });
    return this;
  }

  select(...columns: string[]): this {
    this.#simple = false;
    this.#selectColumns = columns.flat();
    return this;
  }

  addSelect(...columns: string[]): this {
    this.#simple = false;
    (this.#addSelectColumns = mqMut(this.#addSelectColumns)).push(...columns.flat());
    return this;
  }

  selectRaw(expression: string, bindings: unknown[] = []): this {
    this.#simple = false;
    (this.#selectRaws = mqMut(this.#selectRaws)).push({ expression, bindings });
    return this;
  }

  distinct(value = true): this {
    if (value) this.#simple = false;
    this.#distinct = value;
    return this;
  }

  orderBy(column: ColumnHint<T>, direction: "asc" | "desc" = "asc"): this {
    (this.#orders = mqMut(this.#orders)).push({ column, direction });
    return this;
  }

  orderByDesc(column: ColumnHint<T>): this {
    return this.orderBy(column, "desc");
  }

  orderByRaw(sql: string): this {
    this.#simple = false;
    (this.#orders = mqMut(this.#orders)).push({ raw: sql });
    return this;
  }

  /** Karobar / dialect alias for `orderByRaw`. */
  orderBySql(sql: string): this {
    return this.orderByRaw(sql);
  }

  reorder(column?: string, direction: "asc" | "desc" = "asc"): this {
    this.#orders = [];
    if (column !== undefined) (this as ModelQuery<any>).orderBy(column, direction);
    return this;
  }

  inRandomOrder(): this {
    this.#simple = false;
    (this.#orders = mqMut(this.#orders)).push({ raw: "__inRandomOrder__" });
    return this;
  }

  latest(column = "created_at"): this {
    return (this as any).orderBy(column, "desc");
  }

  oldest(column = "created_at"): this {
    return (this as any).orderBy(column, "asc");
  }

  groupBy(...columns: string[]): this {
    this.#simple = false;
    (this.#groupByColumns = mqMut(this.#groupByColumns)).push(...columns.flat());
    return this;
  }

  having(column: string, op: string, value: unknown): this {
    this.#simple = false;
    (this.#havings = mqMut(this.#havings)).push({ column, op, value });
    return this;
  }

  havingRaw(sql: string, bindings: unknown[] = []): this {
    this.#simple = false;
    (this.#havingRaws = mqMut(this.#havingRaws)).push({ sql, bindings });
    return this;
  }

  limit(value: number): this {
    this.#limitValue = value;
    return this;
  }

  take(value: number): this {
    return this.limit(value);
  }

  /**
   * Remove and return this query's limit / offset. Eager loading calls it so a
   * `with({ posts: (q) => q.limit(3) })` limit applies per parent, not to the
   * whole batched query.
   */
  takePaging(): { limit?: number; offset?: number } {
    const out: { limit?: number; offset?: number } = {};
    if (this.#limitValue !== undefined) out.limit = this.#limitValue;
    if (this.#offsetValue !== undefined) out.offset = this.#offsetValue;
    this.#limitValue = undefined;
    this.#offsetValue = undefined;
    return out;
  }

  offset(value: number): this {
    this.#offsetValue = value;
    return this;
  }

  skip(value: number): this {
    return this.offset(value);
  }

  forPage(page: number, perPage = 15): this {
    const p = Math.max(1, Math.floor(page) || 1);
    const size = Math.max(1, Math.floor(perPage) || 15);
    return this.limit(size).offset((p - 1) * size);
  }

  lockForUpdate(): this {
    this.#simple = false;
    this.#lock = "update";
    return this;
  }

  sharedLock(): this {
    this.#simple = false;
    this.#lock = "share";
    return this;
  }

  when(
    condition: unknown,
    callback: (query: this) => void,
    defaultCallback?: (query: this) => void,
  ): this {
    if (condition) callback(this);
    else if (defaultCallback) defaultCallback(this);
    return this;
  }

  /**
   * OR `LIKE %term%` across columns (Karobar list `search`).
   * Empty/whitespace term is a no-op.
   */
  search(columns: string[], term: string): this {
    const needle = String(term ?? "").trim();
    if (!needle || columns.length === 0) return this;
    const pattern = `%${needle}%`;
    return this.where((q) => {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!;
        if (i === 0) (q as ModelQuery<any>).where(col, "like", pattern);
        else (q as ModelQuery<any>).orWhere(col, "like", pattern);
      }
    });
  }

  unless(
    condition: unknown,
    callback: (query: this) => void,
    defaultCallback?: (query: this) => void,
  ): this {
    return this.when(!condition, callback, defaultCallback);
  }

  tap(callback: (query: this) => void): this {
    callback(this);
    return this;
  }

  clone(): ModelQuery<T, TResult> {
    const copy = new ModelQuery<T>(this.model, {
      withTrashed: this.#withTrashed,
      onlyTrashed: this.#onlyTrashed,
      eagerLoad: this.#eagerLoad.map((e) => ({ ...e })),
      withoutGlobalScopes:
        this.#withoutGlobalScopes === true
          ? true
          : this.#withoutGlobalScopes
            ? [...this.#withoutGlobalScopes]
            : undefined,
      connection: this.#connection,
    });
    copy.#wheres = this.#wheres.map((w) => ({ ...w }));
    copy.#pendingAttributes = { ...this.#pendingAttributes };
    copy.#whereIns = this.#whereIns.map((w) => ({
      ...w,
      values: [...w.values],
    }));
    copy.#whereNulls = this.#whereNulls.map((w) => ({ ...w }));
    copy.#whereBetweens = this.#whereBetweens.map((w) => ({
      ...w,
      values: [...w.values] as [unknown, unknown],
    }));
    copy.#whereColumns = this.#whereColumns.map((w) => ({ ...w }));
    copy.#whereRaws = this.#whereRaws.map((w) => ({
      ...w,
      bindings: [...w.bindings],
    }));
    copy.#whereLikes = this.#whereLikes.map((w) => ({ ...w }));
    copy.#dateWheres = this.#dateWheres.map((w) => ({ ...w }));
    copy.#orders = this.#orders.map((o) => ({ ...o }));
    copy.#selectColumns = this.#selectColumns
      ? [...this.#selectColumns]
      : null;
    copy.#addSelectColumns = [...this.#addSelectColumns];
    copy.#selectRaws = this.#selectRaws.map((s) => ({
      ...s,
      bindings: [...s.bindings],
    }));
    copy.#distinct = this.#distinct;
    copy.#limitValue = this.#limitValue;
    copy.#offsetValue = this.#offsetValue;
    copy.#groupByColumns = [...this.#groupByColumns];
    copy.#havings = this.#havings.map((h) => ({ ...h }));
    copy.#havingRaws = this.#havingRaws.map((h) => ({
      ...h,
      bindings: [...h.bindings],
    }));
    copy.#lock = this.#lock;
    copy.#hasConstraints = this.#hasConstraints.map((c) => ({
      ...c,
      existsBindings: c.existsBindings ? [...c.existsBindings] : undefined,
    }));
    copy.#withCounts = [...this.#withCounts];
    copy.#withAggregates = this.#withAggregates.map((a) => ({ ...a }));
    copy.#morphHasConstraints = this.#morphHasConstraints.map((m) => ({
      ...m,
      types: [...m.types],
    }));
    copy.#builderExtras = [...this.#builderExtras];
    copy.#nestedGroups = this.#nestedGroups.map((g) => ({ ...g }));
    copy.#joins = this.#joins.map((j) => ({ ...j }));
    copy.#nestedWhereGroup = this.#nestedWhereGroup;
    copy.#casts = { ...this.#casts };
    copy.#hasQueryCasts = this.#hasQueryCasts;
    copy.#simple = this.#simple;
    copy.#hasRetrievedListeners = this.#hasRetrievedListeners;
    copy.#asRows = this.#asRows;
    return copy as ModelQuery<T, TResult>;
  }

  with(
    ...relations: Array<RelationHint<T> | RelationHint<T>[] | WithMap<T>>
  ): this {
    (this.#eagerLoad = mqMut(this.#eagerLoad)).push(
      ...normalizeWithRelations(relations),
    );
    return this;
  }

  /** Underlying query builder (fresh compile each call). */
  toBase(): QueryBuilder {
    return this.#buildQuery();
  }

  /** Compiled SQL (bindings via `getBindings()`). */
  toSql(): string {
    return this.#buildQuery().toSql();
  }

  /** SQL with bindings interpolated for debugging. */
  toRawSql(): string {
    return this.#buildQuery().toRawSql();
  }

  getBindings(): unknown[] {
    return this.#buildQuery().getBindings();
  }

  dump(): this {
    console.log(this.toRawSql());
    return this;
  }

  dd(): never {
    console.log(this.toRawSql());
    process.exit(1);
  }

  #applySoftDeletes(q: QueryBuilder) {
    if (!usesSoftDeletes(this.model)) return q;
    const col = this.#qualifyParentColumn(deletedAtColumn(this.model));
    if (this.#onlyTrashed) return q.whereNotNull(col);
    if (!this.#withTrashed) return q.whereNull(col);
    return q;
  }

  /**
   * True when this query can compile without a full QueryBuilder
   * (basic wheres + order + limit/offset, optional plain column list).
   * Global scopes that only add basic wheres stay on this path.
   */
  #simplePlan():
    | {
        columns: string;
        scopeWheres: Array<{
          column: string;
          op: string;
          value: unknown;
          boolean: "and" | "or";
        }>;
      }
    | undefined {
    if (this.#exoticConstraints()) return undefined;
    let columns = "*";
    if (!this.#simple) {
      // `select('id', 'name')` is the usual reason a flat query leaves this path.
      if (this.#selectColumns == null) return undefined;
      const plain = plainColumnList(this.#selectColumns);
      if (plain == null || !wheresAreSimple(this.#wheres)) return undefined;
      columns = plain;
    }
    const scopeWheres = this.#scopeWheres();
    if (scopeWheres == null) return undefined;
    return { columns, scopeWheres };
  }

  /** Joins, raws, groups, and other shapes the simple compiler does not emit. */
  #exoticConstraints(): boolean {
    return (
      this.#joins.length > 0 ||
      this.#morphHasConstraints.length > 0 ||
      this.#nestedGroups.length > 0 ||
      this.#builderExtras.length > 0 ||
      this.#withCounts.length > 0 ||
      this.#withAggregates.length > 0 ||
      this.#addSelectColumns.length > 0 ||
      this.#selectRaws.length > 0 ||
      this.#distinct ||
      this.#groupByColumns.length > 0 ||
      this.#havings.length > 0 ||
      this.#havingRaws.length > 0 ||
      this.#lock !== false ||
      this.#whereIns.length > 0 ||
      this.#whereNulls.length > 0 ||
      this.#whereBetweens.length > 0 ||
      this.#whereColumns.length > 0 ||
      this.#whereRaws.length > 0 ||
      this.#whereLikes.length > 0 ||
      this.#dateWheres.length > 0 ||
      this.#hasConstraints.length > 0
    );
  }

  /**
   * Basic wheres added by global scopes, or null when a scope needs the full builder.
   * An empty list means every scope was a no-op (for example no current tenant).
   */
  #scopeWheres(): Array<{
    column: string;
    op: string;
    value: unknown;
    boolean: "and" | "or";
  }> | null {
    if (this.#withoutGlobalScopes === true) return [];
    if (!hasGlobalScopes(this.model)) return [];
    const wheres: Array<{
      column: string;
      op: string;
      value: unknown;
      boolean: "and" | "or";
    }> = [];
    for (const [name, scope] of getGlobalScopes(this.model)) {
      if (this.#withoutGlobalScopes?.has(name)) continue;
      const temp = new ModelQuery(this.model, {
        withoutGlobalScopes: true,
        withTrashed: this.#withTrashed,
        onlyTrashed: this.#onlyTrashed,
      });
      scope(temp as ModelQuery);
      if (!temp.#simple || temp.#exoticConstraints() || !wheresAreSimple(temp.#wheres)) {
        return null;
      }
      for (const where of temp.#wheres) wheres.push(where);
    }
    return wheres;
  }

  /** Compile a simple SELECT matching QueryBuilder's default shape. */
  #compileSimpleSelect(
    conn = this.#queryConnection(),
    plan: {
      columns: string;
      scopeWheres: Array<{
        column: string;
        op: string;
        value: unknown;
        boolean: "and" | "or";
      }>;
    } = { columns: "*", scopeWheres: [] },
  ): { sql: string; params: unknown[] } {
    const dialect = conn.dialect;
    const params: unknown[] = [];

    // Fingerprint (no values) — reuse quoted SQL for repeated list shapes.
    let key = this.#withTrashed ? "T" : this.#onlyTrashed ? "O" : "N";
    key += `\u001e${conn.driver}\u001e${this.model.table}\u001e${plan.columns}`;
    for (const w of plan.scopeWheres) {
      key += `\u001eG\u001e${w.boolean}\u001e${w.column}\u001e${w.op}`;
      if (w.op !== "__null__" && w.op !== "__notnull__") params.push(w.value);
    }
    for (const w of this.#wheres) {
      key += `\u001e${w.boolean}\u001e${w.column}\u001e${w.op}`;
      if (w.op !== "__null__" && w.op !== "__notnull__") params.push(w.value);
    }
    for (const o of this.#orders) {
      if ("raw" in o) key += `\u001eR\u001e${o.raw}`;
      else key += `\u001eO\u001e${o.column}\u001e${o.direction}`;
    }
    if (this.#limitValue !== undefined) key += `\u001eL\u001e${this.#limitValue}`;
    if (this.#offsetValue !== undefined) key += `\u001eF\u001e${this.#offsetValue}`;
    if (usesSoftDeletes(this.model)) key += "\u001eS";

    let byModel = simpleSelectSqlCache.get(this.model);
    if (!byModel) {
      byModel = new Map();
      simpleSelectSqlCache.set(this.model, byModel);
    }
    let sql = byModel.get(key);
    if (sql !== undefined) return { sql, params };

    const wrap = (name: string) => wrapSqlName(dialect, name);
    const whereParts: string[] = [];
    const pushBool = (boolean: "and" | "or") => {
      if (whereParts.length === 0) return "";
      return boolean === "or" ? " OR " : " AND ";
    };

    if (usesSoftDeletes(this.model)) {
      const col = wrap(deletedAtColumn(this.model));
      if (this.#onlyTrashed) {
        whereParts.push(`${col} IS NOT NULL`);
      } else if (!this.#withTrashed) {
        whereParts.push(`${col} IS NULL`);
      }
    }

    const appendWhere = (w: {
      column: string;
      op: string;
      value: unknown;
      boolean: "and" | "or";
    }) => {
      const bool = pushBool(w.boolean);
      const col = wrap(w.column);
      if (w.op === "__null__") {
        whereParts.push(`${bool}${col} IS NULL`);
        return;
      }
      if (w.op === "__notnull__") {
        whereParts.push(`${bool}${col} IS NOT NULL`);
        return;
      }
      whereParts.push(`${bool}${col} ${w.op} ?`);
    };

    // Scope predicates first, then the query's own wheres (matches builder order).
    for (const w of plan.scopeWheres) appendWhere(w);
    for (const w of this.#wheres) appendWhere(w);

    sql = `SELECT ${plan.columns} FROM ${this.model.table}`;
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join("")}`;
    }
    if (this.#orders.length > 0) {
      sql += ` ORDER BY ${this.#orders
        .map((o) => {
          if ("raw" in o) return o.raw;
          return `${wrap(o.column)} ${o.direction.toUpperCase()}`;
        })
        .join(", ")}`;
    }
    if (this.#limitValue !== undefined) {
      sql += ` LIMIT ${this.#limitValue}`;
    }
    if (this.#offsetValue !== undefined) {
      sql += ` OFFSET ${this.#offsetValue}`;
    }
    byModel.set(key, sql);
    return { sql, params };
  }

  /**
   * Fetch rows without allocating a QueryBuilder when the shape is simple
   * or a call-time-compiled whereHas EXISTS (SQLite hot path).
   * Returns undefined to fall back to the full builder path.
   */
  #trySimpleRows():
    | Record<string, unknown>[]
    | Promise<Record<string, unknown>[]>
    | undefined {
    const conn = this.#queryConnection();
    let compiled: { sql: string; params: unknown[] } | undefined;
    const plan = this.#simplePlan();
    if (plan) {
      compiled = this.#compileSimpleSelect(conn, plan);
    } else if (this.#canHasExistsSelect()) {
      compiled = this.#compileHasExistsSelect(conn);
    } else {
      return undefined;
    }
    const { sql, params } = compiled;
    if (conn.allSync) {
      return conn.allSync(sql, params) as Record<string, unknown>[];
    }
    if (
      conn.driver === "postgres" &&
      params.length === 0 &&
      !hasQueryListeners()
    ) {
      const raw = conn.raw as {
        unsafe?: (query: string) => Promise<unknown>;
      } | null;
      if (raw && typeof raw.unsafe === "function") {
        return raw.unsafe(sql) as Promise<Record<string, unknown>[]>;
      }
    }
    return conn.all(sql, params) as Promise<Record<string, unknown>[]>;
  }

  #trySimpleFirst():
    | Record<string, unknown>
    | null
    | Promise<Record<string, unknown> | null>
    | undefined {
    const plan = this.#simplePlan();
    const useHas = !plan && this.#canHasExistsSelect();
    if (!plan && !useHas) return undefined;
    // Match Builder.first(): LIMIT 1 (preserve explicit smaller limit).
    const prev = this.#limitValue;
    if (prev === undefined || prev > 1) this.#limitValue = 1;
    try {
      const conn = this.#queryConnection();
      const { sql, params } = plan
        ? this.#compileSimpleSelect(conn, plan)
        : this.#compileHasExistsSelect(conn);
      if (conn.getSync) {
        return (conn.getSync(sql, params) as Record<string, unknown> | null) ?? null;
      }
      if (conn.allSync) {
        const rows = conn.allSync(sql, params) as Record<string, unknown>[];
        return rows[0] ?? null;
      }
      return conn.all(sql, params).then((rows) => (rows[0] as Record<string, unknown>) ?? null);
    } finally {
      this.#limitValue = prev;
    }
  }

  /**
   * whereHas/whereDoesntHave with call-time EXISTS SQL + flat parent wheres only.
   * Skips QueryBuilder on SQLite get/getSync (same idea as #canSimpleSelect).
   */
  #canHasExistsSelect(): boolean {
    if (this.#hasConstraints.length === 0) return false;
    for (const c of this.#hasConstraints) {
      if (c.existsSql === undefined) return false;
    }
    if (hasGlobalScopes(this.model) && this.#withoutGlobalScopes !== true) {
      return false;
    }
    if (this.#joins.length > 0) return false;
    if (this.#morphHasConstraints.length > 0) return false;
    if (this.#nestedGroups.length > 0) return false;
    if (this.#builderExtras.length > 0) return false;
    if (this.#withCounts.length > 0 || this.#withAggregates.length > 0) return false;
    if (this.#selectColumns || this.#addSelectColumns.length > 0) return false;
    if (this.#selectRaws.length > 0 || this.#distinct) return false;
    if (this.#groupByColumns.length > 0) return false;
    if (this.#havings.length > 0 || this.#havingRaws.length > 0) return false;
    if (this.#lock) return false;
    if (this.#whereIns.length > 0 || this.#whereNulls.length > 0) return false;
    if (this.#whereBetweens.length > 0 || this.#whereColumns.length > 0) return false;
    if (this.#whereRaws.length > 0 || this.#whereLikes.length > 0) return false;
    if (this.#dateWheres.length > 0) return false;
    return true;
  }

  /** Compile SELECT … WHERE [parent] EXISTS (cached subquery) [LIMIT]. */
  #compileHasExistsSelect(
    conn = this.#queryConnection(),
  ): { sql: string; params: unknown[] } {
    const dialect = conn.dialect;
    const params: unknown[] = [];

    // The compiled SQL is dialect specific (identifier quoting), so the driver is part of the key.
    let key = this.#withTrashed ? "T" : this.#onlyTrashed ? "O" : "N";
    key += `\u001e${conn.driver}\u001e${this.model.table}`;
    for (const w of this.#wheres) {
      key += `\u001e${w.boolean}\u001e${w.column}\u001e${w.op}`;
      if (w.op !== "__null__" && w.op !== "__notnull__") params.push(w.value);
    }
    for (const c of this.#hasConstraints) {
      key += `\u001eH\u001e${c.not ? "1" : "0"}\u001e${c.or ? "1" : "0"}\u001e${c.inColumn ?? ""}\u001e${c.existsSql}`;
      if (c.existsBindings?.length) params.push(...c.existsBindings);
    }
    for (const o of this.#orders) {
      if ("raw" in o) key += `\u001eR\u001e${o.raw}`;
      else key += `\u001eO\u001e${o.column}\u001e${o.direction}`;
    }
    if (this.#limitValue !== undefined) key += `\u001eL\u001e${this.#limitValue}`;
    if (this.#offsetValue !== undefined) key += `\u001eF\u001e${this.#offsetValue}`;
    if (usesSoftDeletes(this.model)) key += "\u001eS";

    let byModel = hasExistsSelectSqlCache.get(this.model);
    if (!byModel) {
      byModel = new Map();
      hasExistsSelectSqlCache.set(this.model, byModel);
    }
    let sql = byModel.get(key);
    if (sql !== undefined) return { sql, params };

    const wrap = (name: string) => wrapSqlName(dialect, name);
    const whereParts: string[] = [];
    const pushBool = (boolean: "and" | "or") => {
      if (whereParts.length === 0) return "";
      return boolean === "or" ? " OR " : " AND ";
    };

    if (usesSoftDeletes(this.model)) {
      const col = wrap(deletedAtColumn(this.model));
      if (this.#onlyTrashed) {
        whereParts.push(`${col} IS NOT NULL`);
      } else if (!this.#withTrashed) {
        whereParts.push(`${col} IS NULL`);
      }
    }

    for (const w of this.#wheres) {
      const bool = pushBool(w.boolean);
      const col = wrap(w.column);
      if (w.op === "__null__") {
        whereParts.push(`${bool}${col} IS NULL`);
        continue;
      }
      if (w.op === "__notnull__") {
        whereParts.push(`${bool}${col} IS NOT NULL`);
        continue;
      }
      whereParts.push(`${bool}${col} ${w.op} ?`);
    }

    for (const c of this.#hasConstraints) {
      const bool = pushBool(c.or ? "or" : "and");
      if (c.inColumn) {
        whereParts.push(
          `${bool}${c.inColumn} ${c.not ? "NOT IN" : "IN"} (${c.existsSql})`,
        );
      } else {
        whereParts.push(
          `${bool}${c.not ? "NOT EXISTS" : "EXISTS"} (${c.existsSql})`,
        );
      }
    }

    sql = `SELECT * FROM ${this.model.table}`;
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.join("")}`;
    }
    if (this.#orders.length > 0) {
      sql += ` ORDER BY ${this.#orders
        .map((o) => {
          if ("raw" in o) return o.raw;
          return `${wrap(o.column)} ${o.direction.toUpperCase()}`;
        })
        .join(", ")}`;
    }
    if (this.#limitValue !== undefined) {
      sql += ` LIMIT ${this.#limitValue}`;
    }
    if (this.#offsetValue !== undefined) {
      sql += ` OFFSET ${this.#offsetValue}`;
    }
    byModel.set(key, sql);
    return { sql, params };
  }

  #buildQuery() {
    let q = this.#baseTable();
    q = this.#applySoftDeletes(q);
    q = this.#applyGlobalScopesTo(q);
    this.#qualifyParentConstraintsForJoins();
    q = this.applyConstraintsTo(q);

    if (this.#joins.length > 0) {
      if (!this.#selectColumns && this.#addSelectColumns.length === 0) {
        q = q.select(`${this.model.table}.*`);
      }
      for (const j of this.#joins) {
        if (j.type === "left") {
          q = q.leftJoin(j.table, j.first, j.op, j.second);
        } else if (j.type === "right") {
          q = q.rightJoin(j.table, j.first, j.op, j.second);
        } else {
          q = q.join(j.table, j.first, j.op, j.second);
        }
      }
    }

    if (this.#selectColumns) {
      q = q.select(...this.#selectColumns);
    }
    if (this.#addSelectColumns.length > 0) {
      q = q.addSelect(...this.#addSelectColumns);
    }
    for (const raw of this.#selectRaws) {
      q = q.selectRaw(raw.expression, raw.bindings);
    }
    if (this.#distinct) q = q.distinct();

    for (const o of this.#orders) {
      if ("raw" in o) {
        q =
          o.raw === "__inRandomOrder__"
            ? q.inRandomOrder()
            : q.orderByRaw(o.raw);
      } else q = q.orderBy(o.column, o.direction);
    }

    if (this.#groupByColumns.length > 0) {
      q = q.groupBy(...this.#groupByColumns);
    }
    for (const h of this.#havings) {
      q = q.having(h.column, h.op, h.value);
    }
    for (const h of this.#havingRaws) {
      q = q.havingRaw(h.sql, h.bindings);
    }

    for (const extra of this.#builderExtras) {
      extra(q);
    }

    const aggregates =
      this.#withAggregates.length > 0
        ? this.#withAggregates
        : this.#withCounts.map((relation) => ({
            relation,
            alias: `${relation}_count`,
            fn: "count" as const,
            column: undefined as string | undefined,
            constraint: undefined as ((query: ModelQuery) => void) | undefined,
          }));

    if (aggregates.length > 0) {
      q = q.select(`${this.model.table}.*`);
      for (const agg of aggregates) {
        const meta = resolveAggregateRelation(this.model, agg.relation);
        if (!meta) {
          throw new Error(
            `Cannot aggregate unknown or unsupported relation [${agg.relation}] on ${this.model.name}.`,
          );
        }
        const alias = wrapSqlName(this.model.getConnection().dialect, agg.alias);
        const built = this.#constrainedAggregate(meta, agg);
        if (!built) {
          throw new Error(
            `Relation [${agg.relation}] (${meta.kind}) does not support aggregates yet.`,
          );
        }
        q = q.selectRaw(`(${built.sql}) as ${alias}`, built.bindings);
      }
    }

    if (this.#limitValue !== undefined) q = q.limit(this.#limitValue);
    if (this.#offsetValue !== undefined) q = q.offset(this.#offsetValue);
    if (this.#lock === "update") q = q.lockForUpdate();
    if (this.#lock === "share") q = q.sharedLock();

    return q;
  }

  /**
   * Apply this model's global scopes onto a correlated subquery (`whereHas`, `withCount`, …),
   * qualifying columns with `table` so joined pivot / parent columns never clash.
   * Honors `withoutGlobalScopes()` called inside the user's constraint closure.
   */
  applyGlobalScopesToSubquery(q: QueryBuilder, table: string): QueryBuilder {
    if (this.#withoutGlobalScopes === true) return q;
    if (!hasGlobalScopes(this.model)) return q;
    for (const [name, scope] of getGlobalScopes(this.model)) {
      if (this.#withoutGlobalScopes?.has(name)) continue;
      const temp = new ModelQuery(this.model, { withoutGlobalScopes: true });
      scope(temp as ModelQuery);
      temp.qualifyColumns(table);
      q = temp.applyConstraintsTo(q);
    }
    return q;
  }

  #applyGlobalScopesTo(q: QueryBuilder): QueryBuilder {
    if (this.#withoutGlobalScopes === true) return q;
    if (!hasGlobalScopes(this.model)) return q;
    for (const [name, scope] of getGlobalScopes(this.model)) {
      if (this.#withoutGlobalScopes?.has(name)) continue;
      const temp = new ModelQuery(this.model, {
        withoutGlobalScopes: true,
        withTrashed: this.#withTrashed,
        onlyTrashed: this.#onlyTrashed,
      });
      scope(temp as ModelQuery);
      // Joined related tables often share column names (e.g. tenant_id).
      if (this.#joins.length > 0) {
        temp.qualifyColumns(this.model.table);
      }
      q = temp.applyConstraintsTo(q);
    }
    return q;
  }

  /** Parent-table prefix when BelongsTo whereHas (or other joins) are present. */
  #qualifyParentColumn(column: string): string {
    if (this.#joins.length === 0 || column.includes(".")) return column;
    return `${this.model.table}.${column}`;
  }

  /**
   * Qualify unqualified parent wheres before JOIN so shared columns
   * (tenant_id, …) are not ambiguous on Postgres.
   */
  #qualifyParentConstraintsForJoins(): void {
    if (this.#joins.length === 0) return;
    this.qualifyColumns(this.model.table);
  }

  /**
   * Prefix unqualified columns with `table.` (BelongsTo whereHas → JOIN path).
   */
  qualifyColumns(table: string): this {
    const qual = (column: string) =>
      column.includes(".") ? column : `${table}.${column}`;
    for (const w of this.#wheres) w.column = qual(w.column);
    for (const w of this.#whereIns) w.column = qual(w.column);
    for (const w of this.#whereNulls) w.column = qual(w.column);
    for (const w of this.#whereBetweens) w.column = qual(w.column);
    for (const w of this.#whereLikes) w.column = qual(w.column);
    for (const w of this.#dateWheres) w.column = qual(w.column);
    for (const w of this.#whereColumns) {
      w.first = qual(w.first);
      w.second = qual(w.second);
    }
    return this;
  }

  /** Apply this query's wheres onto a QueryBuilder (exists subqueries). */
  applyConstraintsTo(q: QueryBuilder): QueryBuilder {

    for (const w of this.#wheres) {
      if (w.op === "__null__") {
        q =
          w.boolean === "or" ? q.orWhereNull(w.column) : q.whereNull(w.column);
        continue;
      }
      if (w.op === "__notnull__") {
        q =
          w.boolean === "or"
            ? q.orWhereNotNull(w.column)
            : q.whereNotNull(w.column);
        continue;
      }
      q =
        w.boolean === "or"
          ? q.orWhere(w.column, w.op, w.value)
          : q.where(w.column, w.op, w.value);
    }
    for (const w of this.#whereIns) {
      if (w.boolean === "or") {
        q = w.not
          ? q.orWhereNotIn(w.column, w.values)
          : q.orWhereIn(w.column, w.values);
      } else {
        q = w.not
          ? q.whereNotIn(w.column, w.values)
          : q.whereIn(w.column, w.values);
      }
    }
    for (const w of this.#whereNulls) {
      if (w.boolean === "or") {
        q = w.not ? q.orWhereNotNull(w.column) : q.orWhereNull(w.column);
      } else {
        q = w.not ? q.whereNotNull(w.column) : q.whereNull(w.column);
      }
    }
    for (const w of this.#whereBetweens) {
      if (w.boolean === "or") {
        q = w.not
          ? q.orWhereNotBetween(w.column, w.values)
          : q.orWhereBetween(w.column, w.values);
      } else {
        q = w.not
          ? q.whereNotBetween(w.column, w.values)
          : q.whereBetween(w.column, w.values);
      }
    }
    for (const w of this.#whereColumns) {
      q =
        w.boolean === "or"
          ? q.orWhereColumn(w.first, w.op, w.second)
          : q.whereColumn(w.first, w.op, w.second);
    }
    for (const w of this.#whereRaws) {
      q =
        w.boolean === "or"
          ? q.orWhereRaw(w.sql, w.bindings)
          : q.whereRaw(w.sql, w.bindings);
    }
    for (const w of this.#whereLikes) {
      if (w.boolean === "or") {
        q = w.not
          ? q.orWhereNotLike(w.column, w.value, w.caseSensitive)
          : q.orWhereLike(w.column, w.value, w.caseSensitive);
      } else {
        q = w.not
          ? q.whereNotLike(w.column, w.value, w.caseSensitive)
          : q.whereLike(w.column, w.value, w.caseSensitive);
      }
    }
    for (const w of this.#dateWheres) {
      if (w.kind === "date") q = q.whereDate(w.column, w.op, w.value);
      else if (w.kind === "year") q = q.whereYear(w.column, w.op, Number(w.value));
      else if (w.kind === "month")
        q = q.whereMonth(w.column, w.op, Number(w.value));
      else q = q.whereDay(w.column, w.op, Number(w.value));
    }

    for (const constraint of this.#hasConstraints) {
      q = this.#applyHasConstraint(q, constraint);
    }

    for (const morph of this.#morphHasConstraints) {
      q = this.#applyMorphHasConstraint(q, morph);
    }

    for (const group of this.#nestedGroups) {
      const run = (subQ: QueryBuilder) => {
        const nested = this.model.newQuery({
          withoutGlobalScopes: true,
          withTrashed: this.#withTrashed,
          onlyTrashed: this.#onlyTrashed,
          nestedWhereGroup: true,
        });
        group.callback(nested as ModelQuery);
        nested.applyConstraintsTo(subQ);
      };
      if (group.not) {
        q = group.boolean === "or" ? q.orWhereNot(run) : q.whereNot(run);
      } else {
        q =
          group.boolean === "or" ? q.orWhereNested(run) : q.whereNested(run);
      }
    }

    return q;
  }

  /**
   * HasMany / BelongsToMany / MorphToMany whereHas → correlated EXISTS.
   * Resolve meta + run related callback once at call time (same freeze as BelongsTo join expand).
   * Mergeable flat callbacks become a lightweight apply (no ModelQuery retained).
   */
  #pushHasConstraint(
    relation: string,
    not: boolean,
    or: boolean,
    callback?: (query: ModelQuery) => void,
    metaHint?: RelationMeta | null,
  ): this {
    const meta = metaHint === undefined ? resolveRelation(this.model, relation) : metaHint;
    if (!meta) {
      (this.#hasConstraints = mqMut(this.#hasConstraints)).push({
        relation,
        not,
        or,
        callback,
      });
      return this;
    }

    if (
      meta.kind === "has" ||
      meta.kind === "belongsToMany" ||
      meta.kind === "morphToMany"
    ) {
      let applyRelated: ((sub: QueryBuilder) => void) | undefined;
      let relatedQuery: ModelQuery | undefined;
      const scoped = hasGlobalScopes(meta.related);
      const relatedRef =
        meta.kind === "has" && meta.related.table === this.model.table
          ? `${meta.related.table}_has`
          : meta.related.table;
      if (callback || scoped) {
        const rq = meta.related.newQuery() as ModelQuery;
        callback?.(rq);
        if (this.#relatedConstraintsAreMergeable(rq)) {
          const flat = this.#bindFlatRelatedApply(rq);
          applyRelated = scoped
            ? (sub) => {
                flat(sub);
                rq.applyGlobalScopesToSubquery(sub, relatedRef);
              }
            : flat;
        } else {
          relatedQuery = rq;
          applyRelated = (sub) => {
            rq.applyConstraintsTo(sub);
            rq.applyGlobalScopesToSubquery(sub, relatedRef);
          };
        }
      }
      this.#pushHasConstraintWithRelatedApply(
        relation,
        not,
        or,
        meta,
        applyRelated,
      );
      // Attach relatedQuery on the constraint we just pushed (belongsTo or/not reuse).
      if (relatedQuery) {
        const last = this.#hasConstraints[this.#hasConstraints.length - 1]!;
        last.relatedQuery = relatedQuery;
      }
      return this;
    }

    // belongsTo or/not / unsupported: cache meta (+ optional relatedQuery) for #applyHasConstraint.
    let relatedQuery: ModelQuery | undefined;
    if (callback) {
      relatedQuery = meta.related.newQuery({
        withoutGlobalScopes: true,
      }) as ModelQuery;
      callback(relatedQuery);
    }
    (this.#hasConstraints = mqMut(this.#hasConstraints)).push({
      relation,
      not,
      or,
      meta,
      relatedQuery,
    });
    return this;
  }

  /**
   * HasMany / BelongsToMany / MorphToMany existence constraint.
   * Call-time bake: HasMany → EXISTS (SELECT 1 … LIMIT 1); BelongsToMany →
   * parent.pk IN (SELECT pivot.fk …) when not tenant-correlated (SQLite avoids
   * correlated SCAN). Morph tenant correlation keeps EXISTS.
   */
  #pushHasConstraintWithRelatedApply(
    relation: string,
    not: boolean,
    or: boolean,
    meta: RelationMeta,
    applyRelated?: (sub: QueryBuilder) => void,
  ): this {
    const parentTable = this.model.table;
    let applyExists: ((sub: QueryBuilder) => void) | undefined;
    let inColumn: string | undefined;

    if (meta.kind === "has") {
      const relatedTable = meta.related.table;
      const foreignKey = meta.foreignKey;
      const localKey = meta.localKey;
      const selfAlias = relatedTable === parentTable ? `${relatedTable}_has` : null;
      applyExists = (sub: QueryBuilder) => {
        if (selfAlias) {
          sub.from(`${relatedTable} as ${selfAlias}`);
          sub.whereColumn(
            `${selfAlias}.${foreignKey}`,
            `${parentTable}.${localKey}`,
          );
        } else {
          sub.from(relatedTable);
          sub.whereColumn(
            `${relatedTable}.${foreignKey}`,
            `${parentTable}.${localKey}`,
          );
        }
        if (meta.typeColumn) {
          sub.where(`${selfAlias ?? relatedTable}.${meta.typeColumn}`, meta.morphType);
        }
        applyRelated?.(sub);
      };
    } else if (meta.kind === "belongsToMany" || meta.kind === "morphToMany") {
      const relatedTable = meta.related.table;
      const relatedPk = meta.related.primaryKey;
      const pivotTable = meta.pivotTable;
      const relatedPivotKey = meta.relatedPivotKey;
      const foreignPivotKey = meta.foreignPivotKey;
      const localKey = meta.localKey;
      const morphTypeColumn =
        meta.kind === "morphToMany" ? meta.morphTypeColumn : null;
      const morphTypes = meta.kind === "morphToMany" ? meta.morphTypes : null;
      const pivotTenantKey =
        meta.kind === "morphToMany" ? meta.pivotTenantKey : null;
      const parentTenantKey =
        meta.kind === "morphToMany" ? meta.parentTenantKey : null;
      // Tenant correlation must stay EXISTS; otherwise use IN (same rows, much
      // faster on SQLite without pivot indexes).
      const tenantCorrelated = Boolean(pivotTenantKey && parentTenantKey);
      if (!tenantCorrelated) {
        inColumn = `${parentTable}.${localKey}`;
        applyExists = (sub: QueryBuilder) => {
          sub.from(relatedTable);
          sub.join(
            pivotTable,
            `${pivotTable}.${relatedPivotKey}`,
            "=",
            `${relatedTable}.${relatedPk}`,
          );
          if (morphTypeColumn && morphTypes) {
            sub.whereIn(`${pivotTable}.${morphTypeColumn}`, morphTypes);
          }
          if (meta.kind === "belongsToMany") applyPivotWheres(sub, pivotTable, meta.pivotWheres);
          applyRelated?.(sub);
          sub.select(`${pivotTable}.${foreignPivotKey}`);
        };
      } else {
        applyExists = (sub: QueryBuilder) => {
          sub.from(relatedTable);
          sub.join(
            pivotTable,
            `${pivotTable}.${relatedPivotKey}`,
            "=",
            `${relatedTable}.${relatedPk}`,
          );
          sub.whereColumn(
            `${pivotTable}.${foreignPivotKey}`,
            `${parentTable}.${localKey}`,
          );
          if (morphTypeColumn && morphTypes) {
            sub.whereIn(`${pivotTable}.${morphTypeColumn}`, morphTypes);
            sub.whereColumn(
              `${pivotTable}.${pivotTenantKey}`,
              `${parentTable}.${parentTenantKey}`,
            );
          }
          if (meta.kind === "belongsToMany") applyPivotWheres(sub, pivotTable, meta.pivotWheres);
          applyRelated?.(sub);
        };
      }
    }

    let existsSql: string | undefined;
    let existsBindings: unknown[] | undefined;
    if (applyExists) {
      const sub = this.#baseTable();
      applyExists(sub);
      // SQLite: correlated EXISTS without LIMIT 1 scans the full related table
      // per parent row (~10–50× slower). Match withExists aggregate shape.
      if (!inColumn) {
        sub.select("1");
        sub.limit(1);
      }
      existsSql = sub.toSql();
      existsBindings = sub.getBindings();
    }

    (this.#hasConstraints = mqMut(this.#hasConstraints)).push({
      relation,
      not,
      or,
      meta,
      applyExists,
      existsSql,
      existsBindings,
      inColumn,
    });
    return this;
  }

  /**
   * Snapshot flat related wheres into a closure (no ModelQuery on the hot apply path).
   */
  #bindFlatRelatedApply(from: ModelQuery): (sub: QueryBuilder) => void {
    from = unwrapModelQuery(from);
    const wheres = from.#wheres.length ? from.#wheres.slice() : null;
    const whereIns = from.#whereIns.length ? from.#whereIns.slice() : null;
    const whereNulls = from.#whereNulls.length ? from.#whereNulls.slice() : null;
    const whereBetweens = from.#whereBetweens.length
      ? from.#whereBetweens.slice()
      : null;
    const whereColumns = from.#whereColumns.length
      ? from.#whereColumns.slice()
      : null;
    const whereRaws = from.#whereRaws.length ? from.#whereRaws.slice() : null;
    const whereLikes = from.#whereLikes.length ? from.#whereLikes.slice() : null;
    const dateWheres = from.#dateWheres.length ? from.#dateWheres.slice() : null;

    if (
      !wheres &&
      !whereIns &&
      !whereNulls &&
      !whereBetweens &&
      !whereColumns &&
      !whereRaws &&
      !whereLikes &&
      !dateWheres
    ) {
      return () => {};
    }

    return (q: QueryBuilder) => {
      if (wheres) {
        for (const w of wheres) {
          if (w.op === "__null__") {
            q =
              w.boolean === "or" ? q.orWhereNull(w.column) : q.whereNull(w.column);
            continue;
          }
          if (w.op === "__notnull__") {
            q =
              w.boolean === "or"
                ? q.orWhereNotNull(w.column)
                : q.whereNotNull(w.column);
            continue;
          }
          q =
            w.boolean === "or"
              ? q.orWhere(w.column, w.op, w.value)
              : q.where(w.column, w.op, w.value);
        }
      }
      if (whereIns) {
        for (const w of whereIns) {
          if (w.boolean === "or") {
            q = w.not
              ? q.orWhereNotIn(w.column, w.values)
              : q.orWhereIn(w.column, w.values);
          } else {
            q = w.not
              ? q.whereNotIn(w.column, w.values)
              : q.whereIn(w.column, w.values);
          }
        }
      }
      if (whereNulls) {
        for (const w of whereNulls) {
          if (w.boolean === "or") {
            q = w.not ? q.orWhereNotNull(w.column) : q.orWhereNull(w.column);
          } else {
            q = w.not ? q.whereNotNull(w.column) : q.whereNull(w.column);
          }
        }
      }
      if (whereBetweens) {
        for (const w of whereBetweens) {
          if (w.boolean === "or") {
            q = w.not
              ? q.orWhereNotBetween(w.column, w.values)
              : q.orWhereBetween(w.column, w.values);
          } else {
            q = w.not
              ? q.whereNotBetween(w.column, w.values)
              : q.whereBetween(w.column, w.values);
          }
        }
      }
      if (whereColumns) {
        for (const w of whereColumns) {
          q =
            w.boolean === "or"
              ? q.orWhereColumn(w.first, w.op, w.second)
              : q.whereColumn(w.first, w.op, w.second);
        }
      }
      if (whereRaws) {
        for (const w of whereRaws) {
          q =
            w.boolean === "or"
              ? q.orWhereRaw(w.sql, w.bindings)
              : q.whereRaw(w.sql, w.bindings);
        }
      }
      if (whereLikes) {
        for (const w of whereLikes) {
          if (w.boolean === "or") {
            q = w.not
              ? q.orWhereNotLike(w.column, w.value, w.caseSensitive)
              : q.orWhereLike(w.column, w.value, w.caseSensitive);
          } else {
            q = w.not
              ? q.whereNotLike(w.column, w.value, w.caseSensitive)
              : q.whereLike(w.column, w.value, w.caseSensitive);
          }
        }
      }
      if (dateWheres) {
        for (const w of dateWheres) {
          if (w.kind === "date") q = q.whereDate(w.column, w.op, w.value);
          else if (w.kind === "year")
            q = q.whereYear(w.column, w.op, Number(w.value));
          else if (w.kind === "month")
            q = q.whereMonth(w.column, w.op, Number(w.value));
          else q = q.whereDay(w.column, w.op, Number(w.value));
        }
      }
    };
  }

  /**
   * BelongsTo whereHas/whereRelation → INNER JOIN on related PK (no parent duplication).
   * Expands at call time so #buildQuery matches plain join() (no per-get resolve/newQuery).
   * When the related table is already joined (two BelongsTo on the same table),
   * uses `table as table_relation` so Postgres does not raise 42712.
   * Returns related table alias used in the join.
   */
  #expandBelongsToHasJoin(
    meta: Extract<RelationMeta, { kind: "belongsTo" }>,
    callback?: (query: ModelQuery) => void,
    relation = "",
  ): string {
    const parentTable = this.model.table;
    const relatedTable = meta.related.table;
    const relatedAlias = this.#uniqueBelongsToJoinAlias(relatedTable, relation);
    const joinTable =
      relatedAlias === relatedTable
        ? relatedTable
        : `${relatedTable} as ${relatedAlias}`;

    (this.#joins = mqMut(this.#joins)).push({
      type: "inner",
      table: joinTable,
      first: `${parentTable}.${meta.foreignKey}`,
      op: "=",
      second: `${relatedAlias}.${meta.ownerKey}`,
    });

    if (usesSoftDeletes(meta.related)) {
      const delCol = deletedAtColumn(meta.related);
      (this.#wheres = mqMut(this.#wheres)).push({
        column: `${relatedAlias}.${delCol}`,
        op: "__null__",
        value: null,
        boolean: "and",
      });
    }

    if (callback) {
      const relatedQuery = meta.related.newQuery({
        withoutGlobalScopes: true,
      });
      callback(relatedQuery as ModelQuery);
      relatedQuery.qualifyColumns(relatedAlias);
      if (this.#relatedConstraintsAreMergeable(relatedQuery as ModelQuery)) {
        this.#mergeRelatedConstraints(relatedQuery as ModelQuery);
      } else {
        // Nested has / groups must keep related model identity → apply on QB each build.
        (this.#builderExtras = mqMut(this.#builderExtras)).push((q) => {
          relatedQuery.applyConstraintsTo(q);
        });
      }
    }
    return relatedAlias;
  }

  /** Alias already used by a join table (`accounts` or `accounts as foo`). */
  #joinedNames(): Set<string> {
    const names = new Set<string>();
    for (const join of this.#joins) {
      const parts = join.table.split(/\s+as\s+/i);
      names.add(parts[0]!.trim());
      names.add(parts[parts.length - 1]!.trim());
    }
    return names;
  }

  #uniqueBelongsToJoinAlias(relatedTable: string, relation: string): string {
    const taken = this.#joinedNames();
    const parentTable = this.model.table;
    if (relatedTable === parentTable) {
      let alias = `${relatedTable}_bt`;
      let n = 2;
      while (taken.has(alias)) {
        alias = `${relatedTable}_bt${n++}`;
      }
      return alias;
    }
    if (!taken.has(relatedTable)) {
      return relatedTable;
    }
    const fromRelation = relation
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^\w]+/g, "_")
      .toLowerCase();
    const base = fromRelation
      ? `${relatedTable}_${fromRelation}`
      : `${relatedTable}_bt`;
    let alias = base;
    let n = 2;
    while (taken.has(alias)) {
      alias = `${base}_${n++}`;
    }
    return alias;
  }

  /** True when related callback only added flat wheres (safe to merge onto parent). */
  #relatedConstraintsAreMergeable(from: ModelQuery): boolean {
    from = unwrapModelQuery(from);
    return (
      from.#hasConstraints.length === 0 &&
      from.#morphHasConstraints.length === 0 &&
      from.#nestedGroups.length === 0 &&
      from.#joins.length === 0 &&
      from.#builderExtras.length === 0 &&
      from.#withCounts.length === 0 &&
      from.#withAggregates.length === 0
    );
  }

  /** Copy flat constraints from a related whereHas callback onto this query. */
  #mergeRelatedConstraints(from: ModelQuery): void {
    from = unwrapModelQuery(from);
    if (from.#wheres.length > 0) {
      (this.#wheres = mqMut(this.#wheres)).push(...from.#wheres);
    }
    if (from.#whereIns.length > 0) {
      (this.#whereIns = mqMut(this.#whereIns)).push(...from.#whereIns);
    }
    if (from.#whereNulls.length > 0) {
      (this.#whereNulls = mqMut(this.#whereNulls)).push(...from.#whereNulls);
    }
    if (from.#whereBetweens.length > 0) {
      (this.#whereBetweens = mqMut(this.#whereBetweens)).push(
        ...from.#whereBetweens,
      );
    }
    if (from.#whereColumns.length > 0) {
      (this.#whereColumns = mqMut(this.#whereColumns)).push(
        ...from.#whereColumns,
      );
    }
    if (from.#whereRaws.length > 0) {
      (this.#whereRaws = mqMut(this.#whereRaws)).push(...from.#whereRaws);
    }
    if (from.#whereLikes.length > 0) {
      (this.#whereLikes = mqMut(this.#whereLikes)).push(...from.#whereLikes);
    }
    if (from.#dateWheres.length > 0) {
      (this.#dateWheres = mqMut(this.#dateWheres)).push(...from.#dateWheres);
    }
  }

  #applyHasConstraint(
    q: QueryBuilder,
    constraint: {
      relation: string;
      not: boolean;
      or: boolean;
      callback?: (query: ModelQuery) => void;
      meta?: RelationMeta;
      relatedQuery?: ModelQuery;
      applyExists?: (sub: QueryBuilder) => void;
      existsSql?: string;
      existsBindings?: unknown[];
      inColumn?: string;
    },
  ): QueryBuilder {
    // Fast path: call-time compiled EXISTS / IN (HasMany / BelongsToMany / MorphToMany).
    if (constraint.existsSql !== undefined) {
      const bindings = constraint.existsBindings ?? [];
      const sql = constraint.inColumn
        ? constraint.not
          ? `${constraint.inColumn} not in (${constraint.existsSql})`
          : `${constraint.inColumn} in (${constraint.existsSql})`
        : constraint.not
          ? `not exists (${constraint.existsSql})`
          : `exists (${constraint.existsSql})`;
      return constraint.or
        ? q.orWhereRaw(sql, bindings)
        : q.whereRaw(sql, bindings);
    }
    if (constraint.applyExists) {
      if (constraint.or) {
        return constraint.not
          ? q.orWhereNotExists(constraint.applyExists)
          : q.orWhereExists(constraint.applyExists);
      }
      return constraint.not
        ? q.whereNotExists(constraint.applyExists)
        : q.whereExists(constraint.applyExists);
    }

    const meta =
      constraint.meta ?? resolveRelation(this.model, constraint.relation);
    if (!meta) {
      throw new Error(
        `whereHas supports HasMany/HasOne/BelongsTo/BelongsToMany; [${constraint.relation}] is not supported.`,
      );
    }

    // BelongsTo: INNER JOIN matches hand-written join and beats IN (SELECT) on SQLite.
    // Safe: join is on related PK so parents cannot duplicate. not/or/nested keep IN subquery
    // (nested where builders only serialize WHERE — JOINs would be dropped).
    if (meta.kind === "belongsTo") {
      const parentTable = this.model.table;
      const relatedTable = meta.related.table;
      const joinTable =
        relatedTable === parentTable
          ? `${relatedTable} as ${relatedTable}_bt`
          : relatedTable;
      const relatedAlias =
        relatedTable === parentTable ? `${relatedTable}_bt` : relatedTable;

      if (!constraint.not && !constraint.or && !this.#nestedWhereGroup) {
        if (!this.#selectColumns && this.#addSelectColumns.length === 0) {
          q = q.select(`${parentTable}.*`);
        }
        q = q.join(
          joinTable,
          `${parentTable}.${meta.foreignKey}`,
          "=",
          `${relatedAlias}.${meta.ownerKey}`,
        );
        if (usesSoftDeletes(meta.related)) {
          const delCol = deletedAtColumn(meta.related);
          q = q.whereNull(`${relatedAlias}.${delCol}`);
        }
        if (constraint.relatedQuery) {
          constraint.relatedQuery.qualifyColumns(relatedAlias);
          constraint.relatedQuery.applyConstraintsTo(q);
        } else if (constraint.callback) {
          const relatedQuery = meta.related.newQuery({
            withoutGlobalScopes: true,
          });
          constraint.callback(relatedQuery as ModelQuery);
          relatedQuery.qualifyColumns(relatedAlias);
          relatedQuery.applyConstraintsTo(q);
        }
        return q;
      }

      // or / not / nested where: IN (SELECT ownerKey ...) — reuse call-time relatedQuery when present.
      let relatedQuery = constraint.relatedQuery;
      if (!relatedQuery) {
        relatedQuery = meta.related.newQuery({
          withoutGlobalScopes: true,
        }) as ModelQuery;
        if (constraint.callback) {
          constraint.callback(relatedQuery);
        }
      }
      // Select owner key for the IN subquery (clone-safe: mutate a dedicated select).
      const sub = relatedQuery.clone();
      sub.select(meta.ownerKey);
      const subSql = sub.toSql();
      const bindings = sub.getBindings();
      const col = `${parentTable}.${meta.foreignKey}`;
      const sql = constraint.not
        ? `${col} not in (${subSql})`
        : `${col} in (${subSql})`;
      return constraint.or
        ? q.orWhereRaw(sql, bindings)
        : q.whereRaw(sql, bindings);
    }

    // Fallback (unknown kind / legacy constraint without applyExists).
    const apply = (sub: QueryBuilder) => {
      if (meta.kind === "has") {
        const relatedTable = meta.related.table;
        const parentTable = this.model.table;
        if (relatedTable === parentTable) {
          const alias = `${relatedTable}_has`;
          sub.from(`${relatedTable} as ${alias}`);
          sub.whereColumn(
            `${alias}.${meta.foreignKey}`,
            `${parentTable}.${meta.localKey}`,
          );
        } else {
          sub.from(relatedTable);
          sub.whereColumn(
            `${relatedTable}.${meta.foreignKey}`,
            `${parentTable}.${meta.localKey}`,
          );
        }
        if (meta.typeColumn) sub.where(`${relatedTable}.${meta.typeColumn}`, meta.morphType);
      } else if (
        meta.kind === "belongsToMany" ||
        meta.kind === "morphToMany"
      ) {
        sub.from(meta.related.table);
        sub.join(
          meta.pivotTable,
          `${meta.pivotTable}.${meta.relatedPivotKey}`,
          "=",
          `${meta.related.table}.${meta.related.primaryKey}`,
        );
        sub.whereColumn(
          `${meta.pivotTable}.${meta.foreignPivotKey}`,
          `${this.model.table}.${meta.localKey}`,
        );
        if (meta.kind === "morphToMany") {
          sub.whereIn(
            `${meta.pivotTable}.${meta.morphTypeColumn}`,
            meta.morphTypes,
          );
          if (meta.pivotTenantKey && meta.parentTenantKey) {
            sub.whereColumn(
              `${meta.pivotTable}.${meta.pivotTenantKey}`,
              `${this.model.table}.${meta.parentTenantKey}`,
            );
          }
        }
      } else {
        throw new Error(
          `whereHas supports HasMany/HasOne/BelongsTo/BelongsToMany; [${constraint.relation}] is not supported.`,
        );
      }
      if (constraint.relatedQuery) {
        constraint.relatedQuery.applyConstraintsTo(sub);
      } else if (constraint.callback) {
        const relatedQuery = meta.related.newQuery({
          withoutGlobalScopes: true,
        });
        constraint.callback(relatedQuery as ModelQuery);
        relatedQuery.applyConstraintsTo(sub);
      }
    };

    if (constraint.or) {
      return constraint.not
        ? q.orWhereNotExists(apply)
        : q.orWhereExists(apply);
    }
    return constraint.not ? q.whereNotExists(apply) : q.whereExists(apply);
  }

  #applyMorphHasConstraint(
    q: QueryBuilder,
    constraint: {
      typeColumn: string;
      idColumn: string;
      types: ModelClass[];
      not: boolean;
      or: boolean;
      callback?: (query: ModelQuery) => void;
    },
  ): QueryBuilder {
    const apply = (sub: QueryBuilder) => {
      // EXISTS related row matching morph type+id; OR across types.
      sub.whereNested((inner) => {
        for (let i = 0; i < constraint.types.length; i++) {
          const Related = constraint.types[i]!;
          const type = morphTypeFor(Related);
          const branch = (b: QueryBuilder) => {
            b.where(
              `${this.model.table}.${constraint.typeColumn}`,
              type,
            );
            b.whereExists((ex) => {
              ex.from(Related.table);
              ex.whereColumn(
                `${Related.table}.${Related.primaryKey}`,
                `${this.model.table}.${constraint.idColumn}`,
              );
              if (constraint.callback) {
                const rq = Related.newQuery({ withoutGlobalScopes: true });
                constraint.callback(rq as ModelQuery);
                rq.applyConstraintsTo(ex);
              }
            });
          };
          if (i === 0) inner.whereNested(branch);
          else inner.orWhereNested(branch);
        }
      });
    };

    // Morph existence is on the parent row's type/id pointing at related — use whereExists
    // that correlates type + related table.
    const morphExists = (sub: QueryBuilder) => {
      sub.from(this.model.table);
      // Re-bind: for each type, related.id = parent.idCol AND parent.typeCol = type
      // Simpler: OR of (type=? AND EXISTS related)
      sub.whereRaw("1=1");
    };
    void morphExists;

    // Correct approach: whereExists per type combined
    const combined = (sub: QueryBuilder) => {
      for (let i = 0; i < constraint.types.length; i++) {
        const Related = constraint.types[i]!;
        const type = morphTypeFor(Related);
        const one = (ex: QueryBuilder) => {
          ex.from(Related.table);
          ex.whereColumn(
            `${Related.table}.${Related.primaryKey}`,
            `${this.model.table}.${constraint.idColumn}`,
          );
          ex.where(
            `${this.model.table}.${constraint.typeColumn}`,
            type,
          );
          if (constraint.callback) {
            const rq = Related.newQuery({ withoutGlobalScopes: true });
            constraint.callback(rq as ModelQuery);
            rq.applyConstraintsTo(ex);
          }
        };
        if (i === 0) {
          if (constraint.types.length === 1) {
            one(sub);
          } else {
            sub.whereExists(one);
          }
        } else {
          sub.orWhereExists(one);
        }
      }
      if (constraint.types.length === 1) {
        // already applied directly onto sub when length===1 — but whereExists wrapper needed
      }
    };

    // Always wrap in whereExists for single type too
    const wrap = (sub: QueryBuilder) => {
      if (constraint.types.length === 1) {
        const Related = constraint.types[0]!;
        const type = morphTypeFor(Related);
        sub.from(Related.table);
        sub.whereColumn(
          `${Related.table}.${Related.primaryKey}`,
          `${this.model.table}.${constraint.idColumn}`,
        );
        // type filter on parent — use whereRaw correlated
        sub.whereRaw(
          `${this.model.table}.${constraint.typeColumn} = ?`,
          [type],
        );
        if (constraint.callback) {
          const rq = Related.newQuery({ withoutGlobalScopes: true });
          constraint.callback(rq as ModelQuery);
          rq.applyConstraintsTo(sub);
        }
        return;
      }
      combined(sub);
    };

    void apply;
    if (constraint.or) {
      return constraint.not
        ? q.orWhereNotExists(wrap)
        : q.orWhereExists(wrap);
    }
    return constraint.not ? q.whereNotExists(wrap) : q.whereExists(wrap);
  }

  /** Correlated aggregate subquery for `withCount` / `withSum` / … (optional constraint closure). */
  #constrainedAggregate(
    meta: AggregateRelationMeta,
    agg: {
      fn: "count" | "sum" | "avg" | "min" | "max" | "exists";
      column?: string;
      constraint?: (query: ModelQuery) => void;
    },
  ): { sql: string; bindings: unknown[] } | null {
    const parentTable = this.model.table;
    const sub = this.#baseTable();
    const related = meta.related;
    const relatedTable = related.table;
    // Column prefix for the related side (aliased when the relation is self-referencing).
    let relatedRef = relatedTable;
    switch (meta.kind) {
      case "has": {
        if (relatedTable === parentTable) {
          relatedRef = `${relatedTable}_has`;
          sub.from(`${relatedTable} as ${relatedRef}`);
        } else {
          sub.from(relatedTable);
        }
        sub.whereColumn(`${relatedRef}.${meta.foreignKey}`, `${parentTable}.${meta.localKey}`);
        if (meta.typeColumn) sub.where(`${relatedRef}.${meta.typeColumn}`, meta.morphType);
        break;
      }
      case "belongsTo":
        sub.from(relatedTable);
        sub.whereColumn(`${relatedTable}.${meta.ownerKey}`, `${parentTable}.${meta.foreignKey}`);
        break;
      case "belongsToMany":
      case "morphToMany":
        sub.from(relatedTable);
        sub.join(
          meta.pivotTable,
          `${meta.pivotTable}.${meta.relatedPivotKey}`,
          "=",
          `${relatedTable}.${related.primaryKey}`,
        );
        sub.whereColumn(
          `${meta.pivotTable}.${meta.foreignPivotKey}`,
          `${parentTable}.${meta.localKey}`,
        );
        if (meta.kind === "morphToMany") {
          sub.whereIn(`${meta.pivotTable}.${meta.morphTypeColumn}`, meta.morphTypes);
        } else {
          applyPivotWheres(sub, meta.pivotTable, meta.pivotWheres);
        }
        break;
      case "hasManyThrough":
      case "hasOneThrough": {
        const through = meta.through.table;
        sub.from(relatedTable);
        sub.join(
          through,
          `${through}.${meta.secondLocalKey}`,
          "=",
          `${relatedTable}.${meta.secondKey}`,
        );
        sub.whereColumn(`${through}.${meta.firstKey}`, `${parentTable}.${meta.localKey}`);
        if (usesSoftDeletes(meta.through)) {
          sub.whereNull(`${through}.${deletedAtColumn(meta.through)}`);
        }
        break;
      }
      default:
        return null;
    }
    if (usesSoftDeletes(related)) {
      sub.whereNull(`${relatedRef}.${deletedAtColumn(related)}`);
    }
    if (agg.constraint || hasGlobalScopes(related)) {
      const rq = related.newQuery() as ModelQuery;
      agg.constraint?.(rq);
      rq.applyConstraintsTo(sub);
      rq.applyGlobalScopesToSubquery(sub, relatedRef);
    }
    if (agg.fn === "exists") {
      sub.select("1");
      sub.limit(1);
    } else {
      const column = agg.column
        ? agg.column.includes(".") ? agg.column : `${relatedRef}.${agg.column}`
        : "*";
      sub.selectRaw(
        agg.fn === "count" ? "COUNT(*)" : `${agg.fn.toUpperCase()}(${column})`,
      );
    }
    return { sql: sub.toSql(), bindings: sub.getBindings() };
  }

  first(): T | null | Promise<T | null> {
    const fast = this.#trySimpleFirst();
    if (fast !== undefined) {
      if (fast instanceof Promise) {
        return fast.then((row) => this.#hydrateFirst(row));
      }
      return this.#hydrateFirst(fast);
    }
    const rowOrPromise = this.#buildQuery().first();
    if (rowOrPromise instanceof Promise) {
      return rowOrPromise.then((row) => this.#hydrateFirst(row));
    }
    return this.#hydrateFirst(rowOrPromise);
  }

  #hydrateFirst(
    row: Record<string, unknown> | null,
  ): T | null | Promise<T | null> {
    if (!row) return null;
    const model = this.#makeModel(row);
    const retrieved = this.#hasRetrievedListeners;
    const eager = this.#eagerLoad.length > 0;
    if (!retrieved && !eager) return model;
    return (async () => {
      if (retrieved) await fireModelEvent(model, "retrieved");
      if (eager) await this.#loadEager([model]);
      return model;
    })();
  }

  /** `firstOrFail`. */
  async firstOrFail(): Promise<T> {
    const model = await this.first();
    if (!model) throw new ModelNotFoundException();
    return model;
  }

  /**
   * Fetch matching models as an {@link OrmCollection}.
   * After {@link rows}, returns plain row objects and does not build models.
   * For synchronous SQLite reads, use {@link getSync}.
   */
  get(): TResult extends "row"
    ? Record<string, unknown>[] | Promise<Record<string, unknown>[]>
    : OrmCollection<T> | Promise<OrmCollection<T>> {
    if (this.#asRows) {
      return this.#collectRows() as TResult extends "row"
        ? Record<string, unknown>[] | Promise<Record<string, unknown>[]>
        : OrmCollection<T> | Promise<OrmCollection<T>>;
    }
    return this.#fetchModels() as TResult extends "row"
      ? Record<string, unknown>[] | Promise<Record<string, unknown>[]>
      : OrmCollection<T> | Promise<OrmCollection<T>>;
  }

  #fetchModels(): OrmCollection<T> | Promise<OrmCollection<T>> {
    const fast = this.#trySimpleRows();
    if (fast !== undefined) {
      if (fast instanceof Promise) {
        return fast.then((rows) => this.#hydrateGet(rows));
      }
      return this.#hydrateGet(fast);
    }
    const rowsOrPromise = this.#buildQuery().getRows();
    if (rowsOrPromise instanceof Promise) {
      return rowsOrPromise.then((rows) => this.#hydrateGet(rows));
    }
    return this.#hydrateGet(rowsOrPromise);
  }

  #collectRows():
    | Record<string, unknown>[]
    | Promise<Record<string, unknown>[]> {
    const fast = this.#trySimpleRows();
    if (fast !== undefined) {
      if (fast instanceof Promise) {
        return fast.then((rows) => this.#materializeRows(rows));
      }
      return this.#materializeRows(fast);
    }
    const rowsOrPromise = this.#buildQuery().getRows();
    if (rowsOrPromise instanceof Promise) {
      return rowsOrPromise.then((rows) => this.#materializeRows(rows));
    }
    return this.#materializeRows(rowsOrPromise);
  }

  #hydrateGet(
    rows: Iterable<Record<string, unknown>>,
  ): OrmCollection<T> | Promise<OrmCollection<T>> {
    const modelsOrPromise = this.#hydrateRows(rows);
    if (modelsOrPromise instanceof Promise) {
      return modelsOrPromise.then(async (models) => {
        if (this.#eagerLoad.length > 0) {
          await eagerLoadModels(models, this.#eagerLoad);
        }
        return new OrmCollection(models, { owned: true });
      });
    }
    if (this.#eagerLoad.length > 0) {
      const models = modelsOrPromise;
      const eager = eagerLoadModels(models, this.#eagerLoad);
      if (eager instanceof Promise) {
        return eager.then(() => new OrmCollection(models, { owned: true }));
      }
      return new OrmCollection(models, { owned: true });
    }
    return new OrmCollection(modelsOrPromise, { owned: true });
  }

  /** Row objects for {@link rows}. Falls back to model JSON when the row shortcut cannot apply. */
  #materializeRows(
    rows: Iterable<Record<string, unknown>>,
  ): Record<string, unknown>[] | Promise<Record<string, unknown>[]> {
    if (Array.isArray(rows)) {
      const prepared = this.#prepareJsonRows(rows);
      if (prepared) return prepared;
    }
    const modelsOrPromise = this.#hydrateRows(rows);
    const toRows = (models: T[]): Record<string, unknown>[] | Promise<Record<string, unknown>[]> => {
      if (this.#eagerLoad.length === 0) {
        return models.map((model) => model.toArray());
      }
      const eager = eagerLoadModels(models, this.#eagerLoad);
      const map = () => models.map((model) => model.toArray());
      if (eager instanceof Promise) return eager.then(map);
      return map();
    };
    if (modelsOrPromise instanceof Promise) {
      return modelsOrPromise.then(toRows);
    }
    return toRows(modelsOrPromise);
  }

  /**
   * Plain row objects for JSON when every value matches model JSON
   * (no casts, hidden, or appends) and each eager belongsTo is null
   * because its foreign key was not selected or is null.
   * Returns null to keep the model hydrate path.
   */
  #prepareJsonRows(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] | null {
    if (
      this.#hasRetrievedListeners ||
      this.#hasQueryCasts ||
      this.#connection !== undefined
    ) {
      return null;
    }
    const ctor = this.model;
    const hidden = ctor.hidden;
    const appends = ctor.appends;
    if (
      (hidden != null && hidden.length > 0) ||
      (appends != null && appends.length > 0)
    ) {
      return null;
    }
    if (rows.length > 0 && attributesNeedModelCasts(ctor, rows[0]!)) {
      return null;
    }

    const stamps: string[] = [];
    for (const entry of this.#eagerLoad) {
      const relation = entry.name;
      if (
        entry.constraint ||
        typeof relation !== "string" ||
        relation.includes(".") ||
        relation.includes(" ")
      ) {
        return null;
      }
      const meta = resolveRelation(ctor, relation);
      if (!meta || meta.kind !== "belongsTo") return null;
      const foreignKey = meta.foreignKey;
      for (const row of rows) {
        if (row[foreignKey] != null) return null;
      }
      stamps.push(relation);
    }

    const idKey = ctor.primaryKey;
    const numericId = ctor.incrementing !== false && ctor.keyType !== "string";
    const list =
      rows.constructor === Array
        ? rows
        : (Array.prototype.slice.call(rows) as Record<string, unknown>[]);
    for (let i = 0; i < list.length; i++) {
      const row = list[i]!;
      if (numericId) {
        const value = row[idKey];
        if (typeof value === "string" || typeof value === "bigint") {
          const n = Number(value);
          if (Number.isSafeInteger(n)) row[idKey] = n;
        } else if (typeof value === "number" && Number.isFinite(value)) {
          row[idKey] = Math.trunc(value);
        }
      }
      for (let s = 0; s < stamps.length; s++) row[stamps[s]!] = null;
    }
    return list;
  }

  #queryConnection(): Connection {
    if (this.#connection !== undefined) {
      return resolveConnection(this.#connection);
    }
    return this.model.getConnection();
  }

  #assertSyncReadable(method: string): void {
    const conn = this.#queryConnection();
    if (!conn.allSync || !conn.getSync) {
      throw new Error(
        `${method}() requires SQLite (Connection.allSync / getSync). Use async get()/first() on Postgres.`,
      );
    }
    if (this.#eagerLoad.length > 0) {
      throw new Error(
        `${method}() does not support with() — use async get()/first() for eager loads.`,
      );
    }
    if (this.#hasRetrievedListeners) {
      throw new Error(
        `${method}() does not support retrieved listeners — use async get()/first().`,
      );
    }
  }

  /**
   * SQLite-only synchronous `get()`.
   * No `with()` / retrieved events — for desktop hot paths that cannot await.
   */
  getSync(): TResult extends "row"
    ? Record<string, unknown>[]
    : OrmCollection<T> {
    this.#assertSyncReadable("getSync");
    const fast = this.#trySimpleRows();
    const rows = fast !== undefined ? fast : this.#buildQuery().getRows();
    if (rows instanceof Promise) {
      throw new Error("getSync() expected synchronous rows from SQLite");
    }
    if (this.#asRows) {
      const plain = this.#materializeRows(rows);
      if (plain instanceof Promise) {
        throw new Error("getSync() expected synchronous rows from SQLite");
      }
      return plain as TResult extends "row"
        ? Record<string, unknown>[]
        : OrmCollection<T>;
    }
    const models = this.#hydrateRows(rows);
    if (models instanceof Promise) {
      throw new Error("getSync() cannot hydrate with retrieved listeners");
    }
    return new OrmCollection(models, { owned: true }) as TResult extends "row"
      ? Record<string, unknown>[]
      : OrmCollection<T>;
  }

  /** SQLite-only synchronous `first()`. */
  firstSync(): T | null {
    this.#assertSyncReadable("firstSync");
    const fast = this.#trySimpleFirst();
    const row = fast !== undefined ? fast : this.#buildQuery().first();
    if (row instanceof Promise) {
      throw new Error("firstSync() expected synchronous row from SQLite");
    }
    if (!row) return null;
    return this.#makeModel(row);
  }

  /** SQLite-only synchronous `find($id)`. */
  findSync(id: string | number): T | null {
    return (this.clone() as ModelQuery<any>).where(this.model.primaryKey, id).firstSync();
  }

  async #loadEager(models: T[]): Promise<void> {
    await eagerLoadModels(models, this.#eagerLoad);
  }

  #makeModel(row: Record<string, unknown>): T {
    let model: T;
    if (!this.#hasQueryCasts) {
      model = this.model.newFromBuilder(row) as T;
    } else {
      const ctor = this.model;
      const original = ctor.casts;
      ctor.casts = { ...ctor.getCasts(), ...this.#casts };
      try {
        model = ctor.newFromBuilder(row) as T;
      } finally {
        ctor.casts = original;
      }
    }
    if (this.#connection !== undefined) {
      model.setConnection(this.#connection);
    }
    return model;
  }

  #hydrateRows(
    rows: Iterable<Record<string, unknown>>,
  ): T[] | Promise<T[]> {
    if (this.#hasRetrievedListeners) {
      return (async () => {
        const models: T[] = [];
        for (const row of rows) {
          const model = this.#makeModel(row);
          await fireModelEvent(model, "retrieved");
          models.push(model);
        }
        return models;
      })();
    }
    // Fast path: known array length from SQLite sync results
    if (Array.isArray(rows)) {
      const models = new Array<T>(rows.length);
      // Plain list hydrate: skip #makeModel branch when no query casts / conn override.
      if (!this.#hasQueryCasts && this.#connection === undefined) {
        const Ctor = this.model;
        for (let i = 0; i < rows.length; i++) {
          models[i] = Ctor.newFromBuilder(rows[i]!) as T;
        }
      } else {
        for (let i = 0; i < rows.length; i++) {
          models[i] = this.#makeModel(rows[i]!);
        }
      }
      return models;
    }
    const models: T[] = [];
    for (const row of rows) {
      models.push(this.#makeModel(row));
    }
    return models;
  }

  /** `Builder::create` — insert on this query's connection. */
  async create(attributes: Record<string, unknown>): Promise<T> {
    const merged = { ...this.#pendingAttributes, ...attributes };
    const useAttrs = filterFillable(this.model, merged);
    const model = new this.model() as T;
    if (this.#connection !== undefined) {
      model.setConnection(this.#connection);
    }
    Object.assign(model, useAttrs);
    await model.save();
    return model;
  }

  async paginate(
    perPage = 15,
    page?: number,
    options: { path?: string; pageName?: string } = {},
  ): Promise<LengthAwarePaginator<T>> {
    const total = await this.#countQuery().count();

    const currentPage = resolvePaginatorPage(page, options.pageName);
    const size = Math.max(1, Math.floor(Number(perPage)) || 15);
    const offset = (currentPage - 1) * size;

    const rows = await this.#buildQuery().limit(size).offset(offset).getRows();
    const items = await this.#hydrateRows(rows);
    if (this.#eagerLoad.length > 0) {
      await eagerLoadModels(items, this.#eagerLoad);
    }

    return new LengthAwarePaginator(items, total, size, currentPage, options);
  }

  /** No total count; extra row is used to detect a next page. */
  async simplePaginate(
    perPage = 15,
    page?: number,
    options: { path?: string; pageName?: string } = {},
  ): Promise<Paginator<T>> {
    const currentPage = resolvePaginatorPage(page, options.pageName);
    const size = Math.max(1, Math.floor(Number(perPage)) || 15);
    const offset = (currentPage - 1) * size;
    const rows = await this.#buildQuery()
      .limit(size + 1)
      .offset(offset)
      .getRows();
    const items = await this.#hydrateRows(rows);
    if (this.#eagerLoad.length > 0) {
      await eagerLoadModels(items, this.#eagerLoad);
    }
    return new Paginator(items, size, currentPage, options);
  }

  /** `chunk($count, $callback)`. */
  async chunk(
    count: number,
    callback: (models: OrmCollection<T>) => void | Promise<void>,
  ): Promise<void> {
    let page = 1;
    for (;;) {
      const offset = (page - 1) * count;
      const rows = await this.#buildQuery()
        .limit(count)
        .offset(offset)
        .getRows();
      if (rows.length === 0) break;
      const models = await this.#hydrateRows(rows);
      if (this.#eagerLoad.length > 0) {
        await eagerLoadModels(models, this.#eagerLoad);
      }
      await callback(new OrmCollection(models, { owned: true }));
      if (rows.length < count) break;
      page += 1;
    }
  }

  /**
   * `cursor($chunkSize)` — hydrate models one at a time from a single streamed
   * query, so memory stays flat on large tables. `with()` relations are loaded
   * per batch of `chunkSize` models rather than per row.
   */
  cursor(chunkSize = 1000): LazyCollection<T> {
    return new LazyCollection(() => this.#cursorModels(chunkSize));
  }

  async *#cursorModels(chunkSize: number): AsyncGenerator<T, void, unknown> {
    const size = Math.max(1, Math.floor(chunkSize));
    const fireRetrieved = hasModelEventListeners(this.model, "retrieved");
    const eager = this.#eagerLoad.length > 0;
    let batch: T[] = [];
    for await (const row of this.#buildQuery().cursor(size)) {
      const model = this.#makeModel(row);
      if (fireRetrieved) {
        await fireModelEvent(model, "retrieved");
      }
      if (!eager) {
        yield model;
        continue;
      }
      batch.push(model);
      if (batch.length >= size) {
        await this.#loadEager(batch);
        yield* batch;
        batch = [];
      }
    }
    if (batch.length > 0) {
      await this.#loadEager(batch);
      yield* batch;
    }
  }

  /** `lazy($chunkSize)`. */
  lazy(chunkSize = 1000): LazyCollection<T> {
    return new LazyCollection(() => this.#lazyPages(chunkSize));
  }

  async *#lazyPages(chunkSize: number): AsyncGenerator<T, void, unknown> {
    let page = 1;
    const fireRetrieved = hasModelEventListeners(this.model, "retrieved");
    for (;;) {
      const offset = (page - 1) * chunkSize;
      const rows = await this.#buildQuery()
        .limit(chunkSize)
        .offset(offset)
        .getRows();
      if (rows.length === 0) break;
      for (const row of rows) {
        const model = this.#makeModel(row);
        if (fireRetrieved) {
          await fireModelEvent(model, "retrieved");
        }
        if (this.#eagerLoad.length > 0) {
          await this.#loadEager([model]);
        }
        yield model;
      }
      if (rows.length < chunkSize) break;
      page += 1;
    }
  }

  /** `chunkById`. */
  async chunkById(
    count: number,
    callback: (models: OrmCollection<T>) => void | boolean | Promise<void | boolean>,
    column?: string,
  ): Promise<boolean> {
    return this.#chunkById(count, callback, column ?? this.model.primaryKey, "asc");
  }

  async chunkByIdDesc(
    count: number,
    callback: (models: OrmCollection<T>) => void | boolean | Promise<void | boolean>,
    column?: string,
  ): Promise<boolean> {
    return this.#chunkById(count, callback, column ?? this.model.primaryKey, "desc");
  }

  async #chunkById(
    count: number,
    callback: (models: OrmCollection<T>) => void | boolean | Promise<void | boolean>,
    column: string,
    direction: "asc" | "desc",
  ): Promise<boolean> {
    const size = Math.max(1, Math.floor(count));
    let lastId: unknown = null;
    for (;;) {
      const q = this.clone().reorder(column, direction).limit(size);
      if (lastId !== null) {
        (q as ModelQuery<any>).where(column, direction === "asc" ? ">" : "<", lastId);
      }
      const models = await q.#fetchModels();
      if (models.isEmpty()) return true;
      const result = await callback(models);
      if (result === false) return false;
      lastId = (models.last() as unknown as Record<string, unknown>)?.[column];
      if (models.count() < size) return true;
    }
  }

  /** `lazyById`. */
  lazyById(chunkSize = 1000, column?: string): LazyCollection<T> {
    return new LazyCollection(() =>
      this.#lazyById(chunkSize, column ?? this.model.primaryKey, "asc"),
    );
  }

  lazyByIdDesc(chunkSize = 1000, column?: string): LazyCollection<T> {
    return new LazyCollection(() =>
      this.#lazyById(chunkSize, column ?? this.model.primaryKey, "desc"),
    );
  }

  async *#lazyById(
    chunkSize: number,
    column: string,
    direction: "asc" | "desc",
  ): AsyncGenerator<T, void, unknown> {
    const size = Math.max(1, Math.floor(chunkSize));
    let lastId: unknown = null;
    for (;;) {
      const q = this.clone().reorder(column, direction).limit(size);
      if (lastId !== null) {
        (q as ModelQuery<any>).where(column, direction === "asc" ? ">" : "<", lastId);
      }
      const models = await q.#fetchModels();
      if (models.isEmpty()) return;
      for (const model of models) {
        yield model;
      }
      lastId = (models.last() as unknown as Record<string, unknown>)?.[column];
      if (models.count() < size) return;
    }
  }

  async increment(column: string, amount = 1): Promise<void> {
    await this.#buildQuery().increment(column, amount);
  }

  async decrement(column: string, amount = 1): Promise<void> {
    await this.#buildQuery().decrement(column, amount);
  }

  /** `cursorPaginate`. */
  async cursorPaginate(
    perPage = 15,
    cursor: string | null = null,
    options: { path?: string; cursorName?: string } = {},
  ): Promise<CursorPaginator<T>> {
    const page = await this.#buildQuery().cursorPaginate(
      perPage,
      cursor,
      options,
    );
    const items = await this.#hydrateRows(page.items);
    if (this.#eagerLoad.length > 0) {
      await eagerLoadModels(items, this.#eagerLoad);
    }
    return new CursorPaginator(items, page.perPage, page.options);
  }

  /** `Builder::count($columns = '*')` — honors `distinct()` for non-`*`. */
  async count(column = "*"): Promise<number> {
    let countQ = this.#countQuery();
    if (this.#distinct) {
      countQ = countQ.distinct();
    }
    return countQ.count(column);
  }

  #countQuery(): QueryBuilder {
    let countQ = this.#baseTable();
    countQ = this.#applySoftDeletes(countQ);
    countQ = this.#applyGlobalScopesTo(countQ);
    // BelongsTo whereHas expands to JOIN + qualified related wheres on the parent.
    // Count must include those joins (and builderExtras) or Postgres fails with
    // "missing FROM-clause entry for table …".
    this.#qualifyParentConstraintsForJoins();
    countQ = this.applyConstraintsTo(countQ);
    if (this.#joins.length > 0) {
      for (const j of this.#joins) {
        if (j.type === "left") {
          countQ = countQ.leftJoin(j.table, j.first, j.op, j.second);
        } else if (j.type === "right") {
          countQ = countQ.rightJoin(j.table, j.first, j.op, j.second);
        } else {
          countQ = countQ.join(j.table, j.first, j.op, j.second);
        }
      }
    }
    for (const extra of this.#builderExtras) {
      extra(countQ);
    }
    return countQ;
  }

  async exists(): Promise<boolean> {
    return (await this.#countQuery().first()) != null;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  /** Find by primary key within this query. */
  async find(id: string | number): Promise<T | null> {
    return (this.clone() as ModelQuery<any>)
      .where(this.model.primaryKey, id)
      .first();
  }

  async findOrFail(id: string | number): Promise<T> {
    const model = await this.find(id);
    if (!model) throw new ModelNotFoundException();
    return model;
  }

  /** Exactly one matching model, or throw. */
  async sole(): Promise<T> {
    const rows = await this.clone().limit(2).#fetchModels();
    if (rows.isEmpty()) throw new ModelNotFoundException();
    if (rows.length > 1) {
      throw new ModelNotFoundException("Query returned more than one model.");
    }
    return rows.first()!;
  }

  async value(column: string): Promise<unknown> {
    const model = await this.clone().select(column).first();
    if (!model) return null;
    return (model as unknown as Record<string, unknown>)[column] ?? null;
  }

  /**
   * `Builder::pluck($column, $key = null)`.
   * One column → list {@link Collection}. With `key`, selects both columns and
   * returns a keyed plain object via {@link Collection.pluck}.
   */
  async pluck(column: string): Promise<Collection<unknown>>;
  async pluck(column: string, key: string): Promise<Record<string, unknown>>;
  async pluck(
    column: string,
    key?: string,
  ): Promise<Collection<unknown> | Record<string, unknown>> {
    const cols =
      key !== undefined && key !== column ? [column, key] : [column];
    const models = await this.clone().select(...cols).#fetchModels();
    if (key === undefined) return models.pluck(column);
    return models.pluck(column, key);
  }

  async sum(column: string): Promise<number> {
    return this.#buildQuery().sum(column);
  }

  async avg(column: string): Promise<number | null> {
    return this.#buildQuery().avg(column);
  }

  async min(column: string): Promise<unknown> {
    return this.#buildQuery().min(column);
  }

  async max(column: string): Promise<unknown> {
    return this.#buildQuery().max(column);
  }

  /**
   * Bulk insert. When the model uses timestamps, stamps `created_at`/`updated_at`
   * (row values win). Does not fire creating/created events.
   */
  async insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<boolean> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) return true;

    let finalRows = rows;
    if (this.model.timestamps !== false) {
      const now = nowForConnection(resolveConnection(this.#connection));
      finalRows = rows.map((row) => ({
        created_at: now,
        updated_at: now,
        ...row,
      }));
    }

    return this.#baseTable().insert(finalRows);
  }

  /**
   * `Builder::upsert` — insert or update on unique conflict.
   * When the model uses timestamps, stamps `created_at`/`updated_at`
   * (row values win; `updated_at` is always included in the update column list).
   */
  async upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    uniqueBy: string | string[],
    update: string[] | null = null,
  ): Promise<number> {
    const rows = Array.isArray(values) ? values : [values];
    if (rows.length === 0) return 0;

    let finalRows = rows;
    let finalUpdate = update;
    if (this.model.timestamps !== false) {
      const now = nowForConnection(resolveConnection(this.#connection));
      finalRows = rows.map((row) => ({
        created_at: now,
        updated_at: now,
        ...row,
      }));
      if (finalUpdate == null) {
        const columns = Object.keys(finalRows[0]!);
        const uniqueCols = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
        finalUpdate = columns.filter((c) => !uniqueCols.includes(c));
      } else if (!finalUpdate.includes("updated_at")) {
        finalUpdate = [...finalUpdate, "updated_at"];
      }
    }

    return this.#baseTable().upsert(finalRows, uniqueBy, finalUpdate);
  }

  async update(values: Record<string, unknown>): Promise<number> {
    return this.#buildQuery().update(values);
  }

  async delete(): Promise<number> {
    if (usesSoftDeletes(this.model) && !this.#withTrashed && !this.#onlyTrashed) {
      const col = deletedAtColumn(this.model);
      return this.#buildQuery().update({
        [col]: nowForConnection(resolveConnection(this.#connection)),
      });
    }
    return this.#buildQuery().delete();
  }

  async forceDelete(): Promise<number> {
    return this.#buildQuery().delete();
  }
}
