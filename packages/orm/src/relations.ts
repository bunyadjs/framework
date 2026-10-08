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
import { hasGlobalScopes } from "./scopes.ts";
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

/** Classes seen by the ORM (booted or used as a morph target), keyed by class name — fallback for unmapped types. */
const knownClasses = new Map<string, ModelClass>();
let morphMapRequired = false;

/** Class names used by two different model classes — never resolved by name alone. */
const ambiguousClassNames = new Set<string>();

export function registerMorphClass(model: ModelClass): void {
  if (!model.name) return;
  const existing = knownClasses.get(model.name);
  if (!existing) knownClasses.set(model.name, model);
  else if (existing !== model) ambiguousClassNames.add(model.name);
}

/**
 * `Relation::morphMap` — register aliases, or read the current map when called
 * with no arguments. Pass `merge = false` to replace the existing map.
 */
export function morphMap(): Record<string, ModelClass>;
export function morphMap(map: Record<string, ModelClass>, merge?: boolean): Record<string, ModelClass>;
export function morphMap(
  map?: Record<string, ModelClass>,
  merge = true,
): Record<string, ModelClass> {
  if (map) {
    if (!merge) morphAliases.clear();
    for (const [alias, cls] of Object.entries(map)) {
      morphAliases.set(alias, cls);
    }
  }
  return Object.fromEntries(morphAliases);
}

/** `Relation::enforceMorphMap` — register the map and refuse unmapped classes. */
export function enforceMorphMap(
  map: Record<string, ModelClass>,
  merge = true,
): Record<string, ModelClass> {
  requireMorphMap();
  return morphMap(map, merge);
}

/** `Relation::requireMorphMap` — throw when a model without an alias is used polymorphically. */
export function requireMorphMap(required = true): void {
  morphMapRequired = required;
}

export function requiresMorphMap(): boolean {
  return morphMapRequired;
}

export function clearMorphMap(): void {
  morphAliases.clear();
  morphMapRequired = false;
}

export function morphTypeFor(model: ModelClass): string {
  for (const [alias, cls] of morphAliases) {
    if (cls === model) return alias;
  }
  if (morphMapRequired) {
    throw new Error(
      `No morph map defined for [${model.name}]. Add it to morphMap()/enforceMorphMap() before using it in a polymorphic relation.`,
    );
  }
  registerMorphClass(model);
  return model.name;
}

/** `Relation::getMorphedModel` — class for an alias, or undefined. */
export function getMorphedModel(type: string): ModelClass | undefined {
  const mapped = morphAliases.get(type);
  if (mapped) return mapped;
  if (morphMapRequired || ambiguousClassNames.has(type)) return undefined;
  return knownClasses.get(type);
}

export function resolveMorphType(type: string): ModelClass {
  const mapped = getMorphedModel(type);
  if (mapped) return mapped;
  const hint = ambiguousClassNames.has(type)
    ? ` Two model classes are named [${type}], so it cannot be resolved by name.`
    : "";
  throw new Error(
    `No morph map entry for [${type}].${hint} Call morphMap({ ${type}: Model }) first.`,
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

/** MorphTo relation. */
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

  /** `associate` for morphTo. */
  associate(model: Model): this {
    const row = this.parent as unknown as Record<string, unknown>;
    const Related = model.constructor as ModelClass;
    const key = this.ownerKey ?? Related.primaryKey;
    row[this.typeColumn] = morphTypeFor(Related);
    row[this.idColumn] = (model as unknown as Record<string, unknown>)[key];
    return this;
  }

  /** `dissociate` for morphTo. */
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

/** Multi-row INSERT into a pivot table, grouped by column set and chunked under parameter limits. */
async function insertPivotRows(
  conn: ReturnType<ModelClass["getConnection"]>,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const d = conn.dialect;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const cols = Object.keys(row).sort().join("\u0000");
    const group = groups.get(cols);
    if (group) group.push(row);
    else groups.set(cols, [row]);
  }
  for (const [colKey, group] of groups) {
    const cols = colKey.split("\u0000");
    const colSql = cols.map((c) => wrapSqlName(d, c)).join(", ");
    const rowSql = `(${cols.map(() => "?").join(", ")})`;
    const perChunk = Math.max(1, Math.floor(900 / cols.length));
    for (let i = 0; i < group.length; i += perChunk) {
      const chunk = group.slice(i, i + perChunk);
      await conn.run(
        `INSERT INTO ${wrapSqlName(d, table)} (${colSql}) VALUES ${chunk.map(() => rowSql).join(", ")}`,
        chunk.flatMap((row) => cols.map((c) => row[c])),
      );
    }
  }
}

/** Chunked `DELETE … WHERE fk = ? AND col IN (…)`; returns deleted row count. */
async function deletePivotIn(
  conn: ReturnType<ModelClass["getConnection"]>,
  sqlBase: string,
  baseParams: unknown[],
  inColumn: string,
  ids: Array<string | number>,
): Promise<number> {
  const d = conn.dialect;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 800) {
    const chunk = ids.slice(i, i + 800);
    deleted += Number(
      (await conn.run(
        `${sqlBase} AND ${wrapSqlName(d, inColumn)} IN (${chunk.map(() => "?").join(", ")})`,
        [...baseParams, ...chunk],
      )) ?? 0,
    );
  }
  return deleted;
}

export class BelongsToMany<T extends Model = Model> {
  #baseQuery: ModelQuery<T> | null = null;
  #pivotColumns: string[] = [];
  #pivotTimestamps = false;

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

  /** `withTimestamps` — stamp `created_at` / `updated_at` on pivot writes. */
  withTimestamps(): this {
    this.#pivotTimestamps = true;
    return this;
  }

  #conn() {
    return (this.parent.constructor as ModelClass).getConnection();
  }

  /** Normalize `1`, `[1, 2]` or `{ 1: { role: "x" } }` into `[id, attributes]` pairs. */
  #normalize(
    ids: PivotIds,
    attributes: Record<string, unknown> = {},
  ): Array<[string | number, Record<string, unknown>]> {
    if (ids instanceof Model) {
      return [[(ids as unknown as Record<string, string | number>)[this.related.primaryKey]!, attributes]];
    }
    if (Array.isArray(ids)) {
      return ids.map((id) => [
        id instanceof Model
          ? (id as unknown as Record<string, string | number>)[this.related.primaryKey]!
          : id,
        attributes,
      ]);
    }
    if (ids !== null && typeof ids === "object") {
      return Object.entries(ids).map(([id, attrs]) => [id, { ...attributes, ...attrs }]);
    }
    return [[ids, attributes]];
  }

  #stamp(row: Record<string, unknown>, created: boolean): Record<string, unknown> {
    if (!this.#pivotTimestamps) return row;
    const now = nowForConnection(this.#conn());
    if (created && row.created_at === undefined) row.created_at = now;
    if (row.updated_at === undefined) row.updated_at = now;
    return row;
  }

  async #currentIds(): Promise<Set<string>> {
    const d = this.#conn().dialect;
    const rows = await this.#conn().all<Record<string, unknown>>(
      `SELECT ${wrapSqlName(d, this.relatedPivotKey)} AS id FROM ${wrapSqlName(d, this.pivotTable)} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ?`,
      [this.#parentId()],
    );
    return new Set(rows.map((r) => String(r.id)));
  }

  /** `attach` — one multi-row INSERT per chunk; optional pivot attributes. */
  async attach(
    ids: PivotIds,
    attributes: Record<string, unknown> = {},
  ): Promise<void> {
    const pairs = this.#normalize(ids, attributes);
    if (pairs.length === 0) return;
    const d = this.#conn().dialect;
    const parentId = this.#parentId();
    const rows = pairs.map(([id, attrs]) =>
      this.#stamp(
        { ...attrs, [this.foreignPivotKey]: parentId, [this.relatedPivotKey]: id },
        true,
      ),
    );
    await insertPivotRows(this.#conn(), this.pivotTable, rows);
  }

  /** `detach` — returns the number of deleted pivot rows. */
  async detach(ids?: PivotIds): Promise<number> {
    const d = this.#conn().dialect;
    const base = `DELETE FROM ${wrapSqlName(d, this.pivotTable)} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ?`;
    if (ids === undefined) {
      const result = await this.#conn().run(base, [this.#parentId()]);
      return Number(result ?? 0);
    }
    const list = this.#normalize(ids).map(([id]) => id);
    let deleted = 0;
    for (let i = 0; i < list.length; i += 900) {
      const chunk = list.slice(i, i + 900);
      const result = await this.#conn().run(
        `${base} AND ${wrapSqlName(d, this.relatedPivotKey)} IN (${chunk.map(() => "?").join(", ")})`,
        [this.#parentId(), ...chunk],
      );
      deleted += Number(result ?? 0);
    }
    return deleted;
  }

  /** `updateExistingPivot` — update pivot columns for one related id. Returns affected rows. */
  async updateExistingPivot(
    id: string | number | Model,
    attributes: Record<string, unknown>,
  ): Promise<number> {
    const relatedId = this.#normalize(id)[0]![0];
    const data = this.#stamp({ ...attributes }, false);
    const cols = Object.keys(data);
    if (cols.length === 0) return 0;
    const d = this.#conn().dialect;
    const result = await this.#conn().run(
      `UPDATE ${wrapSqlName(d, this.pivotTable)} SET ${cols.map((c) => `${wrapSqlName(d, c)} = ?`).join(", ")} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ? AND ${wrapSqlName(d, this.relatedPivotKey)} = ?`,
      [...cols.map((c) => data[c]), this.#parentId(), relatedId],
    );
    return Number(result ?? 0);
  }

  /**
   * `sync` — diff against existing rows: attach new, detach removed, and update
   * pivot attributes of kept rows when the map form supplies them.
   */
  async sync(ids: PivotIds, detaching = true): Promise<PivotSyncResult> {
    const pairs = this.#normalize(ids);
    const existing = await this.#currentIds();
    const result: PivotSyncResult = { attached: [], detached: [], updated: [] };
    const wanted = new Set(pairs.map(([id]) => String(id)));
    if (detaching) {
      const gone = [...existing].filter((id) => !wanted.has(id));
      if (gone.length > 0) {
        await this.detach(gone);
        result.detached = gone;
      }
    }
    const toAttach: Array<[string | number, Record<string, unknown>]> = [];
    for (const [id, attrs] of pairs) {
      if (!existing.has(String(id))) {
        toAttach.push([id, attrs]);
        result.attached.push(id);
      } else if (Object.keys(attrs).length > 0) {
        if ((await this.updateExistingPivot(id, attrs)) > 0) result.updated.push(id);
      }
    }
    if (toAttach.length > 0) {
      await this.attach(Object.fromEntries(toAttach));
    }
    return result;
  }

  /** `syncWithoutDetaching`. */
  async syncWithoutDetaching(ids: PivotIds): Promise<PivotSyncResult> {
    return this.sync(ids, false);
  }

  /** `toggle` — attach missing, detach present. */
  async toggle(
    ids: PivotIds,
  ): Promise<{ attached: Array<string | number>; detached: Array<string | number> }> {
    const pairs = this.#normalize(ids);
    const existing = await this.#currentIds();
    const attach: Array<[string | number, Record<string, unknown>]> = [];
    const detached: Array<string | number> = [];
    for (const [id, attrs] of pairs) {
      if (existing.has(String(id))) detached.push(id);
      else attach.push([id, attrs]);
    }
    if (detached.length > 0) await this.detach(detached);
    if (attach.length > 0) await this.attach(Object.fromEntries(attach));
    return { attached: attach.map(([id]) => id), detached };
  }
}

export type PivotIds =
  | string
  | number
  | Model
  | Array<string | number | Model>
  | Record<string | number, Record<string, unknown>>;

export interface PivotSyncResult {
  attached: Array<string | number>;
  detached: Array<string | number>;
  updated: Array<string | number>;
}

/** Options for `morphToMany` beyond the positional args. */
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
    if (hasGlobalScopes(related)) {
      // Query-builder path so the related model's global scopes apply.
      let q = related
        .newQuery()
        .join(
          this.pivotTable,
          `${this.pivotTable}.${this.relatedPivotKey}`,
          "=",
          `${related.table}.${related.primaryKey}`,
        )
        .where(`${this.pivotTable}.${this.foreignPivotKey}`, this.#parentId())
        .whereIn(`${this.pivotTable}.${this.morphTypeColumn}`, this.morphTypes)
        .select(`${related.table}.*`);
      if (this.pivotTenantKey && tenantSql) {
        q = q.where(`${this.pivotTable}.${this.pivotTenantKey}`, tenantId);
      }
      return new OrmCollection((await q.get()).all() as T[], { owned: true });
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

  #conn() {
    return (this.parent.constructor as ModelClass).getConnection();
  }

  #useTenant(): boolean {
    const tenantId = this.#tenantId();
    return Boolean(this.pivotTenantKey && tenantId != null && tenantId !== "");
  }

  async #currentIds(): Promise<Set<string>> {
    const d = this.#conn().dialect;
    const params: unknown[] = [this.#parentId(), ...this.morphTypes];
    let tenantSql = "";
    if (this.#useTenant()) {
      tenantSql = ` AND ${wrapSqlName(d, this.pivotTenantKey!)} = ?`;
      params.push(this.#tenantId());
    }
    const rows = await this.#conn().all<Record<string, unknown>>(
      `SELECT ${wrapSqlName(d, this.relatedPivotKey)} AS id FROM ${wrapSqlName(d, this.pivotTable)} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ? AND ${wrapSqlName(d, this.morphTypeColumn)} IN (${this.#morphTypePlaceholders()})${tenantSql}`,
      params,
    );
    return new Set(rows.map((r) => String(r.id)));
  }

  /** One multi-row INSERT per chunk (was one INSERT per id). */
  async attach(
    ids: Array<string | number> | string | number,
  ): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const morphType = this.getMorphType();
    const useTenant = this.#useTenant();
    await insertPivotRows(
      this.#conn(),
      this.pivotTable,
      list.map((id) => ({
        [this.foreignPivotKey]: this.#parentId(),
        [this.relatedPivotKey]: id,
        [this.morphTypeColumn]: morphType,
        ...(useTenant ? { [this.pivotTenantKey!]: this.#tenantId() } : {}),
      })),
    );
  }

  /** Returns the number of deleted pivot rows. */
  async detach(
    ids?: Array<string | number> | string | number,
  ): Promise<number> {
    const d = this.#conn().dialect;
    const useTenant = this.#useTenant();
    const tenantSql = useTenant ? ` AND ${wrapSqlName(d, this.pivotTenantKey!)} = ?` : "";
    const tenantParams = useTenant ? [this.#tenantId()] : [];
    const base = `DELETE FROM ${wrapSqlName(d, this.pivotTable)}
         WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ?
           AND ${wrapSqlName(d, this.morphTypeColumn)} IN (${this.#morphTypePlaceholders()})${tenantSql}`;
    const baseParams = [this.#parentId(), ...this.morphTypes, ...tenantParams];
    if (ids === undefined) {
      return Number((await this.#conn().run(base, baseParams)) ?? 0);
    }
    const list = Array.isArray(ids) ? ids : [ids];
    return deletePivotIn(this.#conn(), base, baseParams, this.relatedPivotKey, list);
  }

  /** Diff-based: keeps existing rows, attaches new ids, detaches removed ones. */
  async sync(ids: Array<string | number>): Promise<PivotSyncResult> {
    const existing = await this.#currentIds();
    const wanted = new Set(ids.map(String));
    const detached = [...existing].filter((id) => !wanted.has(id));
    const attached = ids.filter((id) => !existing.has(String(id)));
    if (detached.length > 0) await this.detach(detached);
    if (attached.length > 0) await this.attach(attached);
    return { attached, detached, updated: [] };
  }

  async syncWithoutDetaching(ids: Array<string | number>): Promise<PivotSyncResult> {
    const existing = await this.#currentIds();
    const attached = ids.filter((id) => !existing.has(String(id)));
    if (attached.length > 0) await this.attach(attached);
    return { attached, detached: [], updated: [] };
  }

  async toggle(
    ids: Array<string | number> | string | number,
  ): Promise<{ attached: Array<string | number>; detached: Array<string | number> }> {
    const list = Array.isArray(ids) ? ids : [ids];
    const existing = await this.#currentIds();
    const detached = list.filter((id) => existing.has(String(id)));
    const attached = list.filter((id) => !existing.has(String(id)));
    if (detached.length > 0) await this.detach(detached);
    if (attached.length > 0) await this.attach(attached);
    return { attached, detached };
  }
}

/**
 * `morphedByMany` — inverse of a Laravel-style `morphToMany` (`taggables` pivot).
 * Parent is the "tag" side; the pivot stores the related model's id and morph type.
 */
export class MorphedByMany<T extends Model = Model> {
  constructor(
    private parent: Model,
    private related: ModelClass,
    private pivotTable: string,
    private foreignPivotKey: string,
    private relatedPivotKey: string,
    private morphTypeColumn: string,
    private morphType: string,
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

  getMorphType(): string {
    return this.morphType;
  }

  #parentId(): unknown {
    const parentKey = (this.parent.constructor as ModelClass).primaryKey;
    return (this.parent as unknown as Record<string, unknown>)[parentKey];
  }

  #conn() {
    return (this.parent.constructor as ModelClass).getConnection();
  }

  async get(): Promise<OrmCollection<T>> {
    const related = this.related;
    const d = this.#conn().dialect;
    const qRelated = wrapSqlName(d, related.table);
    const qPivot = wrapSqlName(d, this.pivotTable);
    const rows = await this.#conn().all<Record<string, unknown>>(
      `SELECT ${qRelated}.* FROM ${qRelated}
       INNER JOIN ${qPivot}
         ON ${qPivot}.${wrapSqlName(d, this.relatedPivotKey)} = ${qRelated}.${wrapSqlName(d, related.primaryKey)}
       WHERE ${qPivot}.${wrapSqlName(d, this.foreignPivotKey)} = ?
         AND ${qPivot}.${wrapSqlName(d, this.morphTypeColumn)} = ?${softDeleteAliasSql(related, qRelated)}`,
      [this.#parentId(), this.morphType],
    );
    return new OrmCollection(rows.map((row) => new related(row) as T), {
      owned: true,
    });
  }

  async attach(ids: Array<string | number> | string | number): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    await insertPivotRows(
      this.#conn(),
      this.pivotTable,
      list.map((id) => ({
        [this.foreignPivotKey]: this.#parentId(),
        [this.relatedPivotKey]: id,
        [this.morphTypeColumn]: this.morphType,
      })),
    );
  }

  async detach(ids?: Array<string | number> | string | number): Promise<number> {
    const d = this.#conn().dialect;
    const base = `DELETE FROM ${wrapSqlName(d, this.pivotTable)} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ? AND ${wrapSqlName(d, this.morphTypeColumn)} = ?`;
    const baseParams = [this.#parentId(), this.morphType];
    if (ids === undefined) {
      return Number((await this.#conn().run(base, baseParams)) ?? 0);
    }
    const list = Array.isArray(ids) ? ids : [ids];
    return deletePivotIn(this.#conn(), base, baseParams, this.relatedPivotKey, list);
  }

  async #currentIds(): Promise<Set<string>> {
    const d = this.#conn().dialect;
    const rows = await this.#conn().all<Record<string, unknown>>(
      `SELECT ${wrapSqlName(d, this.relatedPivotKey)} AS id FROM ${wrapSqlName(d, this.pivotTable)} WHERE ${wrapSqlName(d, this.foreignPivotKey)} = ? AND ${wrapSqlName(d, this.morphTypeColumn)} = ?`,
      [this.#parentId(), this.morphType],
    );
    return new Set(rows.map((r) => String(r.id)));
  }

  /** Detach missing ids, attach new ones; keeps rows that stay (Laravel `sync`). */
  async sync(ids: Array<string | number>): Promise<void> {
    const existing = await this.#currentIds();
    const wanted = new Set(ids.map(String));
    const detach = [...existing].filter((id) => !wanted.has(id));
    const attach = ids.filter((id) => !existing.has(String(id)));
    if (detach.length > 0) await this.detach(detach);
    if (attach.length > 0) await this.attach(attach);
  }

  async syncWithoutDetaching(ids: Array<string | number>): Promise<void> {
    const existing = await this.#currentIds();
    const missing = ids.filter((id) => !existing.has(String(id)));
    if (missing.length > 0) await this.attach(missing);
  }

  async toggle(ids: Array<string | number> | string | number): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    const existing = await this.#currentIds();
    const detach = list.filter((id) => existing.has(String(id)));
    const attach = list.filter((id) => !existing.has(String(id)));
    if (detach.length > 0) await this.detach(detach);
    if (attach.length > 0) await this.attach(attach);
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
  } else if (rel instanceof MorphedByMany) {
    // Same shape as morphToMany: pivot filtered by morph type, parent key + related key columns.
    meta = {
      kind: "morphToMany",
      related: rel.getRelated(),
      pivotTable: rel.getPivotTable(),
      foreignPivotKey: rel.getForeignPivotKeyName(),
      relatedPivotKey: rel.getRelatedPivotKeyName(),
      localKey: model.primaryKey,
      morphTypeColumn: rel.getMorphTypeColumn(),
      morphTypes: [rel.getMorphType()],
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

/** Relation metadata for aggregate subqueries (adds morphOne / morphMany). */
export type AggregateRelationMeta =
  | RelationMeta
  | {
      kind: "morph";
      related: ModelClass;
      typeColumn: string;
      idColumn: string;
      morphType: string;
      localKey: string;
    };

export function resolveAggregateRelation(
  model: ModelClass,
  relation: string,
): AggregateRelationMeta | null {
  const meta = resolveRelation(model, relation);
  if (meta) return meta;
  let rel: unknown;
  try {
    rel = new model().related(relation);
  } catch {
    return null;
  }
  if (rel instanceof MorphMany || rel instanceof MorphOne) {
    return {
      kind: "morph",
      related: rel.getRelated(),
      typeColumn: rel.getTypeColumn(),
      idColumn: rel.getIdColumn(),
      morphType: rel.getMorphType(),
      localKey: rel.getLocalKeyName(),
    };
  }
  return null;
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
