/**
 * Relation classes and morph map.
 */
import { wrapSqlName } from "@bunyad/database";
import { OrmCollection } from "./orm-collection.ts";
import {
  softDeleteAliasSql,
  nowForConnection,
} from "./model-helpers.ts";
import { Model, type ModelClass } from "./model.ts";
import type { ModelQuery } from "./model-query.ts";
import { isIgnoringTouch } from "./model-strictness.ts";

/** Register morph type aliases (`Relation::morphMap`). */
const morphAliases = new Map<string, ModelClass>();

/** ModelQuery methods that mutate the builder and return it — forwarded onto relations. */
const RELATION_QUERY_CHAIN = [
  "where",
  "orWhere",
  "whereIn",
  "whereNotIn",
  "whereNull",
  "whereNotNull",
  "whereBetween",
  "whereNotBetween",
  "whereColumn",
  "whereRaw",
  "orWhereRaw",
  "whereLike",
  "whereDate",
  "orderBy",
  "orderByDesc",
  "orderByRaw",
  "latest",
  "oldest",
  "limit",
  "offset",
  "take",
  "skip",
  "forPage",
  "select",
  "addSelect",
  "selectRaw",
  "groupBy",
  "having",
  "havingRaw",
  "when",
  "unless",
  "tap",
] as const;

/** ModelQuery methods that return a value — forwarded onto relations. */
const RELATION_QUERY_TERMINAL = [
  "count",
  "exists",
  "sum",
  "avg",
  "min",
  "max",
  "toSql",
  "toRawSql",
  "getBindings",
] as const;

/** Write terminals, forwarded only onto relations that filter one table by a foreign key. */
const RELATION_QUERY_WRITE = ["update", "delete", "forceDelete"] as const;

type RelationQueryKey =
  | (typeof RELATION_QUERY_CHAIN)[number]
  | (typeof RELATION_QUERY_TERMINAL)[number];
type RelationWriteKey = (typeof RELATION_QUERY_WRITE)[number];

/** Types for the methods `installRelationQueryForwarders` adds to every relation. */
type RelationQuery<T extends Model> = Pick<ModelQuery<T>, RelationQueryKey>;
type RelationWrite<T extends Model> = Pick<ModelQuery<T>, RelationWriteKey>;

type RelationWithQuery = {
  getQuery: () => ModelQuery;
};

function installRelationQueryForwarders(
  ctors: Array<{ prototype: object }>,
  writes: Array<{ prototype: object }> = [],
): void {
  for (const Ctor of writes) {
    for (const method of RELATION_QUERY_WRITE) {
      Object.defineProperty(Ctor.prototype, method, {
        value: function (this: RelationWithQuery, ...args: unknown[]) {
          const q = this.getQuery() as unknown as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          return q[method]!(...args);
        },
        configurable: true,
        writable: true,
      });
    }
  }
  for (const Ctor of ctors) {
    for (const method of RELATION_QUERY_CHAIN) {
      Object.defineProperty(Ctor.prototype, method, {
        value: function (this: RelationWithQuery, ...args: unknown[]) {
          const q = this.getQuery() as unknown as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          q[method]!(...args);
          return this;
        },
        configurable: true,
        writable: true,
      });
    }
    for (const method of RELATION_QUERY_TERMINAL) {
      Object.defineProperty(Ctor.prototype, method, {
        value: function (this: RelationWithQuery, ...args: unknown[]) {
          const q = this.getQuery() as unknown as Record<
            string,
            (...a: unknown[]) => unknown
          >;
          return q[method]!(...args);
        },
        configurable: true,
        writable: true,
      });
    }
  }
}

/** Strip `__pivot_*` columns onto `model.pivot`. */
export function applyPivotAttributes(
  model: Model,
  attrs: Record<string, unknown>,
  pivotKeys: string[],
): Model {
  if (pivotKeys.length === 0) return model;
  const pivot: Record<string, unknown> = {};
  const self = model as unknown as Record<string, unknown>;
  for (const key of pivotKeys) {
    const alias = `__pivot_${key}`;
    if (Object.prototype.hasOwnProperty.call(attrs, alias)) {
      pivot[key] = attrs[alias];
      delete self[alias];
    } else if (Object.prototype.hasOwnProperty.call(self, alias)) {
      pivot[key] = self[alias];
      delete self[alias];
    }
  }
  if (Object.keys(pivot).length > 0) {
    self.pivot = pivot;
  }
  return model;
}

function pivotSelectKeys(
  foreignPivotKey: string,
  relatedPivotKey: string,
  extra: string[],
): string[] {
  const keys = [foreignPivotKey, relatedPivotKey];
  for (const col of extra) {
    if (!keys.includes(col)) keys.push(col);
  }
  return keys;
}

export function morphMap(map: Record<string, ModelClass>): void {
  for (const [alias, cls] of Object.entries(map)) {
    morphAliases.set(alias, cls);
  }
}

export function clearMorphMap(): void {
  morphAliases.clear();
}

export function morphTypeFor(model: ModelClass): string {
  for (const [alias, cls] of morphAliases) {
    if (cls === model) return alias;
  }
  return model.name;
}

export function resolveMorphType(type: string): ModelClass {
  const mapped = morphAliases.get(type);
  if (mapped) return mapped;
  throw new Error(
    `No morph map entry for [${type}]. Call morphMap({ ${type}: Model }) first.`,
  );
}

/** MorphMany relation. */
export class MorphMany<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private parent: Model,
    private related: ModelClass,
    private typeColumn: string,
    private idColumn: string,
    private morphType: string,
    private localKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getTypeColumn(): string {
    return this.typeColumn;
  }

  getIdColumn(): string {
    return this.idColumn;
  }

  getMorphType(): string {
    return this.morphType;
  }

  getLocalKeyName(): string {
    return (
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey
    );
  }

  #parentId(): unknown {
    const parentKey =
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  /** Constrained related query (`morphMany().where(…).get()`). */
  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      this.#baseQuery = this.related
        .where(this.typeColumn, this.morphType)
        .where(this.idColumn, this.#parentId()) as unknown as ModelQuery<T>;
    }
    return this.#baseQuery;
  }

  async get(): Promise<OrmCollection<T>> {
    const rows = await this.getQuery().get();
    return new OrmCollection(rows.all() as T[], { owned: true });
  }

  async first(): Promise<T | null> {
    return this.getQuery().first() as Promise<T | null>;
  }

  async create(attributes: Record<string, unknown>): Promise<T> {
    return this.related.create({
      ...attributes,
      [this.typeColumn]: this.morphType,
      [this.idColumn]: this.#parentId(),
    }) as Promise<T>;
  }
}

/** MorphOne relation. */
export class MorphOne<T extends Model = Model> {
  #ofManyColumn?: string;
  #ofManyAggregate?: "min" | "max";
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private parent: Model,
    private related: ModelClass,
    private typeColumn: string,
    private idColumn: string,
    private morphType: string,
    private localKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getTypeColumn(): string {
    return this.typeColumn;
  }

  getIdColumn(): string {
    return this.idColumn;
  }

  getMorphType(): string {
    return this.morphType;
  }

  getLocalKeyName(): string {
    return (
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey
    );
  }

  isOfMany(): boolean {
    return this.#ofManyColumn != null;
  }

  getOfManyColumn(): string | undefined {
    return this.#ofManyColumn;
  }

  getOfManyAggregate(): "min" | "max" | undefined {
    return this.#ofManyAggregate;
  }

  #parentId(): unknown {
    const parentKey =
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  latestOfMany(column?: string): this {
    this.#baseQuery = null;
    return this.ofMany(column ?? this.related.primaryKey, "max");
  }

  oldestOfMany(column?: string): this {
    this.#baseQuery = null;
    return this.ofMany(column ?? this.related.primaryKey, "min");
  }

  ofMany(column: string, aggregate: "min" | "max"): this {
    this.#baseQuery = null;
    this.#ofManyColumn = column;
    this.#ofManyAggregate = aggregate;
    return this;
  }

  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      let q = this.related
        .where(this.typeColumn, this.morphType)
        .where(this.idColumn, this.#parentId()) as unknown as ModelQuery<T>;
      if (this.#ofManyAggregate && this.#ofManyColumn) {
        const dialect = this.related.getConnection().dialect;
        const table = wrapSqlName(dialect, this.related.table);
        const col = wrapSqlName(dialect, this.#ofManyColumn);
        const typeCol = wrapSqlName(dialect, this.typeColumn);
        const idCol = wrapSqlName(dialect, this.idColumn);
        const agg = this.#ofManyAggregate.toUpperCase();
        const soft = softDeleteAliasSql(this.related, table);
        q = q.whereRaw(
          `${table}.${col} = (SELECT ${agg}(${col}) FROM ${table} WHERE ${typeCol} = ? AND ${idCol} = ?${soft})`,
          [this.morphType, this.#parentId()],
        ) as unknown as ModelQuery<T>;
      }
      this.#baseQuery = q;
    }
    return this.#baseQuery;
  }

  async get(): Promise<T | null> {
    return this.first();
  }

  async first(): Promise<T | null> {
    return this.getQuery().first() as Promise<T | null>;
  }

  async create(attributes: Record<string, unknown>): Promise<T> {
    return this.related.create({
      ...attributes,
      [this.typeColumn]: this.morphType,
      [this.idColumn]: this.#parentId(),
    }) as Promise<T>;
  }
}

/** Laravel MorphTo relation. */
export class MorphTo {
  constructor(
    private parent: Model,
    private typeColumn: string,
    private idColumn: string,
    private ownerKey?: string,
  ) {}

  getTypeColumn(): string {
    return this.typeColumn;
  }

  getIdColumn(): string {
    return this.idColumn;
  }

  getOwnerKeyName(): string | undefined {
    return this.ownerKey;
  }

  async get(): Promise<Model | null> {
    return this.first();
  }

  async first(): Promise<Model | null> {
    const row = this.parent as unknown as Record<string, unknown>;
    const type = row[this.typeColumn];
    const id = row[this.idColumn];
    if (type == null || id == null) return null;
    const Related = resolveMorphType(String(type));
    if (this.ownerKey && this.ownerKey !== Related.primaryKey) {
      return Related.where(this.ownerKey, id).first();
    }
    return Related.find(id as string | number);
  }

  /** Laravel `associate` for morphTo. */
  associate(model: Model): this {
    const row = this.parent as unknown as Record<string, unknown>;
    const Related = model.constructor as ModelClass;
    const key = this.ownerKey ?? Related.primaryKey;
    row[this.typeColumn] = morphTypeFor(Related);
    row[this.idColumn] = (model as unknown as Record<string, unknown>)[key];
    return this;
  }

  /** Laravel `dissociate` for morphTo. */
  dissociate(): this {
    const row = this.parent as unknown as Record<string, unknown>;
    row[this.typeColumn] = null;
    row[this.idColumn] = null;
    return this;
  }
}

/** HasMany relation. */
export class HasMany<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private parent: Model,
    private related: ModelClass,
    private foreignKey: string,
    private localKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getForeignKeyName(): string {
    return this.foreignKey;
  }

  getLocalKeyName(): string {
    return (
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey
    );
  }

  #parentId(): unknown {
    const parentKey =
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  /** Constrained related query (`hasMany().where(…).orderBy(…).get()`). */
  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      this.#baseQuery = this.related.where(
        this.foreignKey,
        this.#parentId(),
      ) as unknown as ModelQuery<T>;
    }
    return this.#baseQuery;
  }

  async get(): Promise<OrmCollection<T>> {
    const rows = await this.getQuery().get();
    return new OrmCollection(rows.all() as T[], { owned: true });
  }

  async first(): Promise<T | null> {
    return this.getQuery().first() as Promise<T | null>;
  }

  async create(attributes: Record<string, unknown>): Promise<T> {
    return this.related.create({
      ...attributes,
      [this.foreignKey]: this.#parentId(),
    }) as Promise<T>;
  }

  /** Bump `updated_at` on matching related rows. */
  async touch(): Promise<boolean> {
    if (isIgnoringTouch(this.related)) return false;
    if (this.related.timestamps === false) return false;
    const parentId = this.#parentId();
    if (parentId === undefined || parentId === null) return false;
    const now = nowForConnection(this.related.getConnection());
    await this.related
      .newQuery()
      .where(this.foreignKey, parentId)
      .update({ updated_at: now });
    return true;
  }
}

/** HasOne relation. */
export class HasOne<T extends Model = Model> {
  #ofManyColumn?: string;
  #ofManyAggregate?: "min" | "max";
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private parent: Model,
    private related: ModelClass,
    private foreignKey: string,
    private localKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getForeignKeyName(): string {
    return this.foreignKey;
  }

  getLocalKeyName(): string {
    return (
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey
    );
  }

  isOfMany(): boolean {
    return this.#ofManyColumn != null;
  }

  getOfManyColumn(): string | undefined {
    return this.#ofManyColumn;
  }

  getOfManyAggregate(): "min" | "max" | undefined {
    return this.#ofManyAggregate;
  }

  #parentId(): unknown {
    const parentKey =
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  /** Latest related row by column (default primary key). */
  latestOfMany(column?: string): this {
    this.#baseQuery = null;
    return this.ofMany(column ?? this.related.primaryKey, "max");
  }

  /** Oldest related row by column (default primary key). */
  oldestOfMany(column?: string): this {
    this.#baseQuery = null;
    return this.ofMany(column ?? this.related.primaryKey, "min");
  }

  /** Constrain to the related row with min/max of `column`. */
  ofMany(column: string, aggregate: "min" | "max"): this {
    this.#baseQuery = null;
    this.#ofManyColumn = column;
    this.#ofManyAggregate = aggregate;
    return this;
  }

  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      let q = this.related.where(
        this.foreignKey,
        this.#parentId(),
      ) as unknown as ModelQuery<T>;
      if (this.#ofManyAggregate && this.#ofManyColumn) {
        const dialect = this.related.getConnection().dialect;
        const table = wrapSqlName(dialect, this.related.table);
        const col = wrapSqlName(dialect, this.#ofManyColumn);
        const fk = wrapSqlName(dialect, this.foreignKey);
        const agg = this.#ofManyAggregate.toUpperCase();
        const soft = softDeleteAliasSql(this.related, table);
        q = q.whereRaw(
          `${table}.${col} = (SELECT ${agg}(${col}) FROM ${table} WHERE ${fk} = ?${soft})`,
          [this.#parentId()],
        ) as unknown as ModelQuery<T>;
      }
      this.#baseQuery = q;
    }
    return this.#baseQuery;
  }

  async get(): Promise<T | null> {
    return this.first();
  }

  async first(): Promise<T | null> {
    return this.getQuery().first() as Promise<T | null>;
  }

  async create(attributes: Record<string, unknown>): Promise<T> {
    return this.related.create({
      ...attributes,
      [this.foreignKey]: this.#parentId(),
    }) as Promise<T>;
  }

  /** Bump `updated_at` on matching related rows. */
  async touch(): Promise<boolean> {
    if (isIgnoringTouch(this.related)) return false;
    if (this.related.timestamps === false) return false;
    const parentKey =
      this.localKey ?? (this.parent.constructor as ModelClass).primaryKey;
    const parentId = (this.parent as unknown as Record<string, unknown>)[parentKey];
    if (parentId === undefined || parentId === null) return false;
    const now = nowForConnection(this.related.getConnection());
    await this.related
      .newQuery()
      .where(this.foreignKey, parentId)
      .update({ updated_at: now });
    return true;
  }
}


/** HasManyThrough relation (Parent → Through → Related). */
export class HasManyThrough<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private parent: Model,
    private related: ModelClass,
    private through: ModelClass,
    private firstKey: string,
    private secondKey: string,
    private localKey: string,
    private secondLocalKey: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getThrough(): ModelClass {
    return this.through;
  }

  getFirstKeyName(): string {
    return this.firstKey;
  }

  getSecondKeyName(): string {
    return this.secondKey;
  }

  getLocalKeyName(): string {
    return this.localKey;
  }

  getSecondLocalKeyName(): string {
    return this.secondLocalKey;
  }

  #parentId(): unknown {
    return (this.parent as unknown as Record<string, unknown>)[this.localKey];
  }

  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      this.#baseQuery = this.related
        .newQuery()
        .join(
          this.through.table,
          `${this.related.table}.${this.secondKey}`,
          "=",
          `${this.through.table}.${this.secondLocalKey}`,
        )
        .where(`${this.through.table}.${this.firstKey}`, this.#parentId())
        .select(`${this.related.table}.*`) as unknown as ModelQuery<T>;
    }
    return this.#baseQuery;
  }

  async get(): Promise<OrmCollection<T>> {
    const parentId = this.#parentId();
    if (parentId == null) return new OrmCollection<T>([], { owned: true });
    const rows = await this.getQuery().get();
    return new OrmCollection(rows.all() as T[], { owned: true });
  }

  async first(): Promise<T | null> {
    const parentId = this.#parentId();
    if (parentId == null) return null;
    return this.getQuery().first() as Promise<T | null>;
  }
}

/**
 * HasOneThrough — same join as HasManyThrough, returns a single related model.
 */
export class HasOneThrough<T extends Model = Model> {
  #many: HasManyThrough<T>;

  constructor(
    parent: Model,
    related: ModelClass,
    through: ModelClass,
    firstKey: string,
    secondKey: string,
    localKey: string,
    secondLocalKey: string,
  ) {
    this.#many = new HasManyThrough(
      parent,
      related,
      through,
      firstKey,
      secondKey,
      localKey,
      secondLocalKey,
    );
  }

  getRelated(): ModelClass {
    return this.#many.getRelated();
  }

  getThrough(): ModelClass {
    return this.#many.getThrough();
  }

  getFirstKeyName(): string {
    return this.#many.getFirstKeyName();
  }

  getSecondKeyName(): string {
    return this.#many.getSecondKeyName();
  }

  getLocalKeyName(): string {
    return this.#many.getLocalKeyName();
  }

  getSecondLocalKeyName(): string {
    return this.#many.getSecondLocalKeyName();
  }

  /** Underlying many-through relation (for eager load reuse). */
  asHasManyThrough(): HasManyThrough<T> {
    return this.#many;
  }

  getQuery(): ModelQuery<T> {
    return this.#many.getQuery().limit(1) as unknown as ModelQuery<T>;
  }

  async get(): Promise<T | null> {
    return this.first();
  }

  async first(): Promise<T | null> {
    return this.#many.first();
  }
}

/** BelongsTo relation. */
export class BelongsTo<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;

  constructor(
    private child: Model,
    private related: ModelClass,
    private foreignKey: string,
    private ownerKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getForeignKeyName(): string {
    return this.foreignKey;
  }

  getOwnerKeyName(): string {
    return this.ownerKey ?? this.related.primaryKey;
  }

  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      const id = (this.child as unknown as Record<string, unknown>)[
        this.foreignKey
      ];
      if (id === undefined || id === null) {
        this.#baseQuery = this.related
          .newQuery()
          .whereRaw("0 = 1") as unknown as ModelQuery<T>;
      } else {
        this.#baseQuery = this.related.where(
          this.getOwnerKeyName(),
          id,
        ) as unknown as ModelQuery<T>;
      }
    }
    return this.#baseQuery;
  }

  async get(): Promise<T | null> {
    return this.first();
  }

  async first(): Promise<T | null> {
    return this.getQuery().first() as Promise<T | null>;
  }

  /** Set the foreign key from a related model (or null). */
  associate(model: T | null): this {
    const key = this.getOwnerKeyName();
    (this.child as unknown as Record<string, unknown>)[this.foreignKey] = model
      ? (model as unknown as Record<string, unknown>)[key]
      : null;
    return this;
  }

  /** Clear the foreign key. */
  dissociate(): this {
    (this.child as unknown as Record<string, unknown>)[this.foreignKey] = null;
    return this;
  }

  /**
   * Bump related parent's `updated_at` (query update).
   * Honors `Model.withoutTouching` / `isIgnoringTouch` on the related class.
   */
  async touch(): Promise<boolean> {
    return this.#touchImpl(false);
  }

  /** Sync variant for Model sync-persist path. */
  touchSync(): boolean {
    return this.#touchImpl(true) as boolean;
  }

  #touchImpl(sync: boolean): boolean | Promise<boolean> {
    if (isIgnoringTouch(this.related)) return false;
    if (this.related.timestamps === false) return false;
    const id = (this.child as unknown as Record<string, unknown>)[
      this.foreignKey
    ];
    if (id === undefined || id === null) return false;
    const conn = this.related.getConnection();
    const now = nowForConnection(conn);
    const ownerKey = this.getOwnerKeyName();
    if (sync) {
      if (typeof conn.runSync !== "function") {
        throw new Error("BelongsTo.touchSync requires a sync connection.");
      }
      const dialect = conn.dialect;
      const table = wrapSqlName(dialect, this.related.table);
      const setCol = wrapSqlName(dialect, "updated_at");
      const whereCol = wrapSqlName(dialect, ownerKey);
      conn.runSync(
        `UPDATE ${table} SET ${setCol} = ? WHERE ${whereCol} = ?`,
        [now, id],
      );
      return true;
    }
    return this.related
      .newQuery()
      .where(ownerKey, id)
      .update({ updated_at: now })
      .then(() => true);
  }
}

/** BelongsToMany relation. */
export class BelongsToMany<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;
  #pivotColumns: string[] = [];

  constructor(
    private parent: Model,
    private related: ModelClass,
    private pivotTable: string,
    private foreignPivotKey: string,
    private relatedPivotKey: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getPivotTable(): string {
    return this.pivotTable;
  }

  getForeignPivotKeyName(): string {
    return this.foreignPivotKey;
  }

  getRelatedPivotKeyName(): string {
    return this.relatedPivotKey;
  }

  getPivotColumns(): string[] {
    return [...this.#pivotColumns];
  }

  /** Include extra pivot table columns on related models as `model.pivot`. */
  withPivot(...columns: Array<string | string[]>): this {
    this.#baseQuery = null;
    for (const col of columns.flat()) {
      if (typeof col === "string" && col.trim() && !this.#pivotColumns.includes(col)) {
        this.#pivotColumns.push(col);
      }
    }
    return this;
  }

  #parentId(): unknown {
    const parentKey = (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  #pivotKeys(): string[] {
    if (this.#pivotColumns.length === 0) return [];
    return pivotSelectKeys(
      this.foreignPivotKey,
      this.relatedPivotKey,
      this.#pivotColumns,
    );
  }

  getQuery(): ModelQuery<T> {
    if (!this.#baseQuery) {
      const related = this.related;
      let q = related
        .newQuery()
        .join(
          this.pivotTable,
          `${this.pivotTable}.${this.relatedPivotKey}`,
          "=",
          `${related.table}.${related.primaryKey}`,
        )
        .where(`${this.pivotTable}.${this.foreignPivotKey}`, this.#parentId())
        .select(`${related.table}.*`) as unknown as ModelQuery<T>;
      for (const col of this.#pivotKeys()) {
        q = q.selectRaw(
          `${this.pivotTable}.${col} as __pivot_${col}`,
        ) as unknown as ModelQuery<T>;
      }
      this.#baseQuery = q;
    }
    return this.#baseQuery;
  }

  #hydratePivot(models: T[]): void {
    const keys = this.#pivotKeys();
    if (keys.length === 0) return;
    for (const model of models) {
      applyPivotAttributes(
        model,
        model as unknown as Record<string, unknown>,
        keys,
      );
    }
  }

  async get(): Promise<OrmCollection<T>> {
    const rows = await this.getQuery().get();
    const models = rows.all() as T[];
    this.#hydratePivot(models);
    return new OrmCollection(models, { owned: true });
  }

  async first(): Promise<T | null> {
    const model = (await this.getQuery().first()) as T | null;
    if (model) this.#hydratePivot([model]);
    return model;
  }

  async attach(
    ids: Array<string | number> | string | number,
  ): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const parent = this.parent.constructor as ModelClass;
    for (const id of list) {
      await parent.getConnection().run(
        `INSERT INTO ${this.pivotTable} (${this.foreignPivotKey}, ${this.relatedPivotKey}) VALUES (?, ?)`,
        [this.#parentId(), id],
      );
    }
  }

  async detach(
    ids?: Array<string | number> | string | number,
  ): Promise<void> {
    const parent = this.parent.constructor as ModelClass;
    if (ids === undefined) {
      await parent.getConnection().run(
        `DELETE FROM ${this.pivotTable} WHERE ${this.foreignPivotKey} = ?`,
        [this.#parentId()],
      );
      return;
    }
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      await parent.getConnection().run(
        `DELETE FROM ${this.pivotTable}
         WHERE ${this.foreignPivotKey} = ? AND ${this.relatedPivotKey} = ?`,
        [this.#parentId(), id],
      );
    }
  }

  async sync(ids: Array<string | number>): Promise<void> {
    await this.detach();
    await this.attach(ids);
  }

  /** Attach missing ids only. */
  async syncWithoutDetaching(ids: Array<string | number>): Promise<void> {
    const existing = new Set(
      (await this.get()).map((m) =>
        String((m as unknown as Record<string, unknown>)[this.related.primaryKey]),
      ),
    );
    const missing = ids.filter((id) => !existing.has(String(id)));
    if (missing.length > 0) await this.attach(missing);
  }

  /** Attach missing, detach present. */
  async toggle(ids: Array<string | number> | string | number): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const existing = new Set(
      (await this.get()).map((m) =>
        String((m as unknown as Record<string, unknown>)[this.related.primaryKey]),
      ),
    );
    const attachIds: Array<string | number> = [];
    const detachIds: Array<string | number> = [];
    for (const id of list) {
      if (existing.has(String(id))) detachIds.push(id);
      else attachIds.push(id);
    }
    if (detachIds.length > 0) await this.detach(detachIds);
    if (attachIds.length > 0) await this.attach(attachIds);
  }
}

/** Options for `morphToMany` beyond the Laravel positional args. */
export type MorphToManyOptions = {
  table?: string;
  foreignPivotKey?: string;
  relatedPivotKey?: string;
  morphTypeColumn?: string;
  /** Pivot `model_type` values matched (includes legacy aliases). */
  morphTypes?: string[];
  /** Tenant column on the pivot table (when set, rows are tenant-scoped). */
  pivotTenantKey?: string;
  /**
   * Tenant column on the parent model.
   * Defaults to `pivotTenantKey` when omitted.
   */
  parentTenantKey?: string;
};

/** Polymorphic many-to-many (e.g. Contact → Role via `model_has_roles`). */
export class MorphToMany<T extends Model = Model> {
  constructor(
    private parent: Model,
    private related: ModelClass,
    private pivotTable: string,
    private foreignPivotKey: string,
    private relatedPivotKey: string,
    private morphTypeColumn: string,
    private morphTypes: string[],
    private pivotTenantKey?: string,
    private parentTenantKey?: string,
  ) {}

  getRelated(): ModelClass {
    return this.related;
  }

  getPivotTable(): string {
    return this.pivotTable;
  }

  getForeignPivotKeyName(): string {
    return this.foreignPivotKey;
  }

  getRelatedPivotKeyName(): string {
    return this.relatedPivotKey;
  }

  getMorphTypeColumn(): string {
    return this.morphTypeColumn;
  }

  getMorphTypes(): string[] {
    return [...this.morphTypes];
  }

  getPivotTenantKey(): string | undefined {
    return this.pivotTenantKey;
  }

  getParentTenantKey(): string | undefined {
    return this.parentTenantKey ?? this.pivotTenantKey;
  }

  /** Primary morph type written on attach (first configured type). */
  getMorphType(): string {
    return this.morphTypes[0] ?? morphTypeFor(this.parent.constructor as ModelClass);
  }

  #parentId(): unknown {
    const parentKey = (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  #tenantId(): unknown {
    const key = this.getParentTenantKey();
    if (!this.pivotTenantKey || !key) return undefined;
    return (this.parent as unknown as Record<string, unknown>)[key];
  }

  #morphTypePlaceholders(): string {
    return this.morphTypes.map(() => "?").join(", ");
  }

  async get(): Promise<OrmCollection<T>> {
    const parent = this.parent.constructor as ModelClass;
    const related = this.related;
    const params: unknown[] = [this.#parentId(), ...this.morphTypes];
    let tenantSql = "";
    const tenantId = this.#tenantId();
    if (this.pivotTenantKey && tenantId != null && tenantId !== "") {
      tenantSql = ` AND ${this.pivotTable}.${this.pivotTenantKey} = ?`;
      params.push(tenantId);
    }
    const rows = await parent.getConnection().all<Record<string, unknown>>(
      `SELECT ${related.table}.* FROM ${related.table}
       INNER JOIN ${this.pivotTable}
         ON ${this.pivotTable}.${this.relatedPivotKey} = ${related.table}.${related.primaryKey}
       WHERE ${this.pivotTable}.${this.foreignPivotKey} = ?
         AND ${this.pivotTable}.${this.morphTypeColumn} IN (${this.#morphTypePlaceholders()})${tenantSql}`,
      params,
    );
    return new OrmCollection(rows.map((row) => new related(row) as T), { owned: true });
  }

  async attach(
    ids: Array<string | number> | string | number,
  ): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const parent = this.parent.constructor as ModelClass;
    const morphType = this.getMorphType();
    const tenantId = this.#tenantId();
    const useTenant = Boolean(this.pivotTenantKey && tenantId != null && tenantId !== "");
    for (const id of list) {
      if (useTenant) {
        await parent.getConnection().run(
          `INSERT INTO ${this.pivotTable} (${this.foreignPivotKey}, ${this.relatedPivotKey}, ${this.morphTypeColumn}, ${this.pivotTenantKey}) VALUES (?, ?, ?, ?)`,
          [this.#parentId(), id, morphType, tenantId],
        );
      } else {
        await parent.getConnection().run(
          `INSERT INTO ${this.pivotTable} (${this.foreignPivotKey}, ${this.relatedPivotKey}, ${this.morphTypeColumn}) VALUES (?, ?, ?)`,
          [this.#parentId(), id, morphType],
        );
      }
    }
  }

  async detach(
    ids?: Array<string | number> | string | number,
  ): Promise<void> {
    const parent = this.parent.constructor as ModelClass;
    const tenantId = this.#tenantId();
    const useTenant = Boolean(this.pivotTenantKey && tenantId != null && tenantId !== "");
    const tenantSql = useTenant
      ? ` AND ${this.pivotTenantKey} = ?`
      : "";
    const tenantParams = useTenant ? [tenantId] : [];
    if (ids === undefined) {
      await parent.getConnection().run(
        `DELETE FROM ${this.pivotTable}
         WHERE ${this.foreignPivotKey} = ?
           AND ${this.morphTypeColumn} IN (${this.#morphTypePlaceholders()})${tenantSql}`,
        [this.#parentId(), ...this.morphTypes, ...tenantParams],
      );
      return;
    }
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      await parent.getConnection().run(
        `DELETE FROM ${this.pivotTable}
         WHERE ${this.foreignPivotKey} = ?
           AND ${this.relatedPivotKey} = ?
           AND ${this.morphTypeColumn} IN (${this.#morphTypePlaceholders()})${tenantSql}`,
        [this.#parentId(), id, ...this.morphTypes, ...tenantParams],
      );
    }
  }

  async sync(ids: Array<string | number>): Promise<void> {
    await this.detach();
    await this.attach(ids);
  }

  async syncWithoutDetaching(ids: Array<string | number>): Promise<void> {
    const existing = new Set(
      (await this.get()).map((m) =>
        String((m as unknown as Record<string, unknown>)[this.related.primaryKey]),
      ),
    );
    const missing = ids.filter((id) => !existing.has(String(id)));
    if (missing.length > 0) await this.attach(missing);
  }

  async toggle(ids: Array<string | number> | string | number): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const existing = new Set(
      (await this.get()).map((m) =>
        String((m as unknown as Record<string, unknown>)[this.related.primaryKey]),
      ),
    );
    const attachIds: Array<string | number> = [];
    const detachIds: Array<string | number> = [];
    for (const id of list) {
      if (existing.has(String(id))) detachIds.push(id);
      else attachIds.push(id);
    }
    if (detachIds.length > 0) await this.detach(detachIds);
    if (attachIds.length > 0) await this.attach(attachIds);
  }
}

export type RelationMeta =
  | {
      kind: "has";
      related: ModelClass;
      foreignKey: string;
      localKey: string;
    }
  | {
      kind: "belongsTo";
      related: ModelClass;
      foreignKey: string;
      ownerKey: string;
    }
  | {
      kind: "belongsToMany";
      related: ModelClass;
      pivotTable: string;
      foreignPivotKey: string;
      relatedPivotKey: string;
      localKey: string;
      pivotColumns: string[];
    }
  | {
      kind: "morphToMany";
      related: ModelClass;
      pivotTable: string;
      foreignPivotKey: string;
      relatedPivotKey: string;
      localKey: string;
      morphTypeColumn: string;
      morphTypes: string[];
      pivotTenantKey?: string;
      parentTenantKey?: string;
    }
  | {
      kind: "hasManyThrough";
      related: ModelClass;
      through: ModelClass;
      firstKey: string;
      secondKey: string;
      localKey: string;
      secondLocalKey: string;
    }
  | {
      kind: "hasOneThrough";
      related: ModelClass;
      through: ModelClass;
      firstKey: string;
      secondKey: string;
      localKey: string;
      secondLocalKey: string;
    };

/** Cached relation meta per model class (avoids `new model()` + related() per compile). */
const relationMetaCache = new WeakMap<ModelClass, Map<string, RelationMeta | null>>();

export function resolveRelation(
  model: ModelClass,
  relation: string,
): RelationMeta | null {
  let byName = relationMetaCache.get(model);
  if (!byName) {
    byName = new Map();
    relationMetaCache.set(model, byName);
  }
  if (byName.has(relation)) return byName.get(relation)!;

  const instance = new model();
  let rel: unknown;
  try {
    rel = instance.related(relation);
  } catch {
    byName.set(relation, null);
    return null;
  }

  let meta: RelationMeta | null = null;
  if (rel instanceof HasMany || rel instanceof HasOne) {
    meta = {
      kind: "has",
      related: rel.getRelated(),
      foreignKey: rel.getForeignKeyName(),
      localKey: rel.getLocalKeyName(),
    };
  } else if (rel instanceof BelongsTo) {
    meta = {
      kind: "belongsTo",
      related: rel.getRelated(),
      foreignKey: rel.getForeignKeyName(),
      ownerKey: rel.getOwnerKeyName(),
    };
  } else if (rel instanceof BelongsToMany) {
    meta = {
      kind: "belongsToMany",
      related: rel.getRelated(),
      pivotTable: rel.getPivotTable(),
      foreignPivotKey: rel.getForeignPivotKeyName(),
      relatedPivotKey: rel.getRelatedPivotKeyName(),
      localKey: model.primaryKey,
      pivotColumns: rel.getPivotColumns(),
    };
  } else if (rel instanceof MorphToMany) {
    meta = {
      kind: "morphToMany",
      related: rel.getRelated(),
      pivotTable: rel.getPivotTable(),
      foreignPivotKey: rel.getForeignPivotKeyName(),
      relatedPivotKey: rel.getRelatedPivotKeyName(),
      localKey: model.primaryKey,
      morphTypeColumn: rel.getMorphTypeColumn(),
      morphTypes: rel.getMorphTypes(),
      pivotTenantKey: rel.getPivotTenantKey(),
      parentTenantKey: rel.getParentTenantKey(),
    };
  } else if (rel instanceof HasManyThrough) {
    meta = {
      kind: "hasManyThrough",
      related: rel.getRelated(),
      through: rel.getThrough(),
      firstKey: rel.getFirstKeyName(),
      secondKey: rel.getSecondKeyName(),
      localKey: rel.getLocalKeyName(),
      secondLocalKey: rel.getSecondLocalKeyName(),
    };
  } else if (rel instanceof HasOneThrough) {
    meta = {
      kind: "hasOneThrough",
      related: rel.getRelated(),
      through: rel.getThrough(),
      firstKey: rel.getFirstKeyName(),
      secondKey: rel.getSecondKeyName(),
      localKey: rel.getLocalKeyName(),
      secondLocalKey: rel.getSecondLocalKeyName(),
    };
  }
  byName.set(relation, meta);
  return meta;
}

export async function countRelation(model: Model, relation: string): Promise<number> {
  const value = await aggregateRelation(model, relation, "count");
  return Number(value ?? 0);
}

/** Run COUNT/SUM/AVG/MIN/MAX/EXISTS for a relation on one model instance. */
export async function aggregateRelation(
  model: Model,
  relation: string,
  fn: "count" | "sum" | "avg" | "min" | "max" | "exists",
  column?: string,
): Promise<unknown> {
  const ctor = model.constructor as ModelClass;
  const meta = resolveRelation(ctor, relation);
  if (!meta) {
    throw new Error(`Unknown relation [${relation}] for load aggregate.`);
  }
  const id = (model as unknown as Record<string, unknown>)[ctor.primaryKey];

  if (meta.kind === "has") {
    let q = meta.related.where(meta.foreignKey, id);
    if (fn === "exists") return (await q.exists()) ? 1 : 0;
    if (fn === "count") return q.count();
    if (fn === "sum") return q.sum(column!);
    if (fn === "avg") return q.avg(column!);
    if (fn === "min") return q.min(column!);
    return q.max(column!);
  }

  if (meta.kind === "belongsTo") {
    const fk = (model as unknown as Record<string, unknown>)[meta.foreignKey];
    if (fk == null) return fn === "exists" ? 0 : fn === "count" || fn === "sum" ? 0 : null;
    let q = meta.related.where(meta.ownerKey, fk);
    if (fn === "exists") return (await q.exists()) ? 1 : 0;
    if (fn === "count") return q.count();
    if (fn === "sum") return q.sum(column!);
    if (fn === "avg") return q.avg(column!);
    if (fn === "min") return q.min(column!);
    return q.max(column!);
  }

  if (meta.kind === "hasManyThrough" || meta.kind === "hasOneThrough") {
    // Through-relations have no pivot table — the SQL below only applies to
    // belongsToMany/morphToMany. Previously this fell through unguarded and
    // built a query with `undefined` in place of a pivot table/column.
    throw new Error(
      `aggregateRelation() does not support "${meta.kind}" relations yet (relation [${relation}]).`,
    );
  }

  const morphSql =
    meta.kind === "morphToMany"
      ? ` AND ${meta.pivotTable}.${meta.morphTypeColumn} IN (${meta.morphTypes.map(() => "?").join(", ")})`
      : "";
  const morphParams =
    meta.kind === "morphToMany" ? [...meta.morphTypes] : [];
  let tenantSql = "";
  const tenantParams: unknown[] = [];
  if (meta.kind === "morphToMany" && meta.pivotTenantKey && meta.parentTenantKey) {
    const tenantId = (model as unknown as Record<string, unknown>)[
      meta.parentTenantKey
    ];
    if (tenantId != null && tenantId !== "") {
      tenantSql = ` AND ${meta.pivotTable}.${meta.pivotTenantKey} = ?`;
      tenantParams.push(tenantId);
    }
  }

  const row = await ctor.getConnection().get<{ v: unknown }>(
    fn === "exists"
      ? `SELECT 1 as v FROM ${meta.related.table}
     INNER JOIN ${meta.pivotTable}
       ON ${meta.pivotTable}.${meta.relatedPivotKey} = ${meta.related.table}.${meta.related.primaryKey}
         WHERE ${meta.pivotTable}.${meta.foreignPivotKey} = ?${morphSql}${tenantSql} LIMIT 1`
      : `SELECT ${fn === "count" ? "COUNT(*)" : `${fn.toUpperCase()}(${column ?? "*"})`} as v FROM ${meta.related.table}
         INNER JOIN ${meta.pivotTable}
           ON ${meta.pivotTable}.${meta.relatedPivotKey} = ${meta.related.table}.${meta.related.primaryKey}
         WHERE ${meta.pivotTable}.${meta.foreignPivotKey} = ?${morphSql}${tenantSql}`,
    [id, ...morphParams, ...tenantParams],
  );
  if (fn === "exists") return row ? 1 : 0;
  return row?.v ?? (fn === "count" || fn === "sum" ? 0 : null);
}

export interface HasMany<T extends Model = Model> extends RelationQuery<T>, RelationWrite<T> {}
export interface HasOne<T extends Model = Model> extends RelationQuery<T>, RelationWrite<T> {}
export interface MorphMany<T extends Model = Model> extends RelationQuery<T>, RelationWrite<T> {}
export interface MorphOne<T extends Model = Model> extends RelationQuery<T>, RelationWrite<T> {}
export interface HasManyThrough<T extends Model = Model> extends RelationQuery<T> {}
export interface HasOneThrough<T extends Model = Model> extends RelationQuery<T> {}
export interface BelongsTo<T extends Model = Model> extends RelationQuery<T> {}
export interface BelongsToMany<T extends Model = Model> extends RelationQuery<T> {}

installRelationQueryForwarders([
  MorphMany,
  MorphOne,
  HasMany,
  HasOne,
  HasManyThrough,
  HasOneThrough,
  BelongsTo,
  BelongsToMany,
], [MorphMany, MorphOne, HasMany, HasOne]);
