import type {
  Connection,
  DatabaseManager,
  DateInput,
  QueryBuilder,
} from "@bunyad/database";
import {
  DatabaseManager as Db,
  setDefaultConnection,
  connections,
  LengthAwarePaginator,
  CursorPaginator,
  Paginator,
  dateTimeForStorage,
  withoutQueryWriteHook,
  wrapSqlName,
} from "@bunyad/database";
import { Collection, LazyCollection } from "@bunyad/common";
import { OrmCollection } from "./orm-collection.ts";
import {
  Attribute,
  castFromStorage,
  castToStorage,
  hashCastValue,
  isAlreadyHashed,
  enumFromStorage,
  enumToStorage,
  isAttribute,
  isCastType,
  isEnumCast,
  type CastDefinition,
  type CastType,
} from "./casts.ts";
import {
  bootIfNotBooted,
  fireModelEvent,
  hasAnyModelEventListeners,
  hasModelEventListeners,
  observeModel,
  registerModelEvent,
  withoutModelEvents,
  type ModelEventListener,
  type ModelEventName,
  type ModelObserver,
} from "./model-events.ts";
import { resolveModelBuilder } from "./decorators.ts";
import {
  addGlobalScope as registerGlobalScope,
  getGlobalScopes,
  hasGlobalScopes,
  installLocalScopeCallStatic,
  removeGlobalScope as unregisterGlobalScope,
  type GlobalScopeCallback,
} from "./scopes.ts";

import {
  deletedAtColumn,
  normalizeWithRelations,
  nowForConnection,
  parseRelationAlias,
  singular,
  usesSoftDeletes,
} from "./model-helpers.ts";
import {
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
  aggregateRelation,
  clearMorphMap,
  morphMap,
  morphTypeFor,
  type MorphToManyOptions,
} from "./relations.ts";
import {
  eagerLoadAggregates,
  eagerLoadModels,
  type EagerAggregateSpec,
} from "./eager.ts";
import { ModelQuery, MODEL_QUERY_TARGET } from "./model-query.ts";
import {
  LazyLoadingViolationException,
  MassAssignmentException,
  MissingAttributeException,
  isIgnoringTouch,
  isInsideEagerLoad,
  modelsShouldPreventAccessingMissingAttributes,
  modelsShouldPreventLazyLoading,
  modelsShouldPreventSilentlyDiscardingAttributes,
  preventAccessingMissingAttributes as setPreventAccessingMissingAttributes,
  preventLazyLoading as setPreventLazyLoading,
  preventSilentlyDiscardingAttributes as setPreventSilentlyDiscardingAttributes,
  shouldBeStrict as setShouldBeStrict,
  withoutTouching as runWithoutTouching,
} from "./model-strictness.ts";

export type { CastType, CastDefinition, EnumCast } from "./casts.ts";
export {
  Attribute,
  AsCollection,
  AsFluent,
  AsEnumCollection,
} from "./casts.ts";
export type {
  ModelEventName,
  ModelEventListener,
  ModelObserver,
} from "./model-events.ts";
export { resetModelEventsForTests } from "./model-events.ts";

/** Thrown when a model query returns no results. */
export class ModelNotFoundException extends Error {
  constructor(message = "No query results for model.") {
    super(message);
    this.name = "ModelNotFoundException";
  }
}

/**
 * Relation factory on `static relations`.
 * Parameter is bivariant so subclasses may type `(m: Contact) => …`
 * without breaking `typeof Contact` assignability to `typeof Model`.
 */
export type RelationFactory = {
  bivarianceHack(model: Model): unknown;
}["bivarianceHack"];

export type RelationsMap =
  | Record<string, RelationFactory>
  | (() => Record<string, RelationFactory>);

export type ModelClass = typeof Model & {
  table: string;
  primaryKey: string;
  softDeletes?: boolean;
  deletedAt?: string;
  /** Property or method (`casts()`). */
  casts?: Record<string, CastDefinition> | (() => Record<string, CastDefinition>);
  /** Relation factories (`static relations = { posts: (m) => m.hasMany(Post) }`). */
  relations?: RelationsMap;
  hidden?: string[];
  appends?: string[];
  fillable?: readonly string[] | string[];
  guarded?: readonly string[] | string[];
};

export type ModelQueryOptions = {
  withTrashed?: boolean;
  onlyTrashed?: boolean;
  eagerLoad?: import("./model-helpers.ts").NormalizedEagerRelation[];
  withoutGlobalScopes?: true | string[];
  /** Named connection (`User.on('secondary')`) or a Connection handle. */
  connection?: string | Connection;
  /**
   * Nested `where(callback)` group — BelongsTo whereHas must use IN/EXISTS,
   * not JOIN (nested builders only emit WHERE SQL).
   */
  nestedWhereGroup?: boolean;
};

/** Resolve a connection name or handle to a live Connection. */
export function resolveConnection(
  connection?: string | Connection | null,
): Connection {
  if (connection == null) {
    return defaultConnection ?? connections.connection();
  }
  if (typeof connection === "string") {
    return connections.connection(connection);
  }
  return connection;
}

let defaultConnection: Connection | undefined;

const fillableSetCache = new WeakMap<
  ModelClass,
  { list: readonly string[] | string[]; set: Set<string> }
>();

const syncInsertColsCache = new WeakMap<
  ModelClass,
  { cols: string[]; timestamps: boolean; incrementing: boolean; key: string }
>();

/** Reused bind list for multi-column sync inserts (single-threaded). */
const persistValueScratch: unknown[] = [];

function cachedSyncInsertColumns(ctor: ModelClass): string[] | null {
  const fillables = ctor.fillable ?? [];
  if (fillables.length === 0) return null;
  const usesTimestamps = ctor.timestamps !== false;
  const incrementing = ctor.incrementing !== false;
  const key = ctor.primaryKey;
  let cached = syncInsertColsCache.get(ctor);
  if (
    cached &&
    cached.timestamps === usesTimestamps &&
    cached.incrementing === incrementing &&
    cached.key === key
  ) {
    return cached.cols;
  }
  const cols: string[] = [];
  for (let i = 0; i < fillables.length; i++) {
    const col = fillables[i]!;
    if (incrementing && col === key) continue;
    cols.push(col);
  }
  if (usesTimestamps) {
    if (!cols.includes("created_at")) cols.push("created_at");
    if (!cols.includes("updated_at")) cols.push("updated_at");
  }
  syncInsertColsCache.set(ctor, {
    cols,
    timestamps: usesTimestamps,
    incrementing,
    key,
  });
  return cols;
}

export function filterFillable(
  model: ModelClass,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const fillables = model.fillable ?? [];
  const guardeds = model.guarded ?? ["*"];
  const strictDiscard = modelsShouldPreventSilentlyDiscardingAttributes();

  if (fillables.length > 0) {
    let cached = fillableSetCache.get(model);
    if (!cached || cached.list !== fillables) {
      cached = { list: fillables, set: new Set(fillables) };
      fillableSetCache.set(model, cached);
    }
    const allowed = cached.set;
    const discarded: string[] = [];
    for (const key of Object.keys(attributes)) {
      if (!allowed.has(key)) discarded.push(key);
    }
    if (discarded.length === 0) return attributes;
    if (strictDiscard) {
      throw new MassAssignmentException(
        `Add [${discarded.join(", ")}] to fillable property to allow mass assignment on [${(model as { name?: string }).name ?? "Model"}].`,
      );
    }
    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in attributes) out[key] = attributes[key];
    }
    return out;
  }

  if (!guardeds.includes("*")) {
    const blocked = new Set(guardeds);
    const discarded: string[] = [];
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (blocked.has(key)) discarded.push(key);
      else out[key] = value;
    }
    if (discarded.length > 0 && strictDiscard) {
      throw new MassAssignmentException(
        `Add [${discarded.join(", ")}] to fillable property to allow mass assignment on [${(model as { name?: string }).name ?? "Model"}].`,
      );
    }
    return out;
  }

  // Empty fillable + guarded ["*"] → allow all (make:model DX; set fillable in apps)
  return { ...attributes };
}

/** Expose `scopeFoo` methods as `.foo()` on model queries. */
/** Per-class: does this model define any `scopeFoo` local scopes? */
const hasLocalScopesCache = new WeakMap<ModelClass, boolean>();

function modelHasLocalScopes(model: ModelClass): boolean {
  const cached = hasLocalScopesCache.get(model);
  if (cached !== undefined) return cached;
  let has = false;
  let proto: object | null = model as unknown as object;
  while (proto && proto !== Function.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (
        key.length > 5 &&
        key.startsWith("scope") &&
        typeof (proto as Record<string, unknown>)[key] === "function"
      ) {
        has = true;
        break;
      }
    }
    if (has) break;
    proto = Object.getPrototypeOf(proto);
  }
  hasLocalScopesCache.set(model, has);
  return has;
}

/**
 * Expose `scopeFoo` methods as `.foo()` on model queries.
 * Skip the Proxy entirely when the model has no local scopes (list/get hot path).
 */
function withLocalScopeProxy<M extends Model>(
  query: ModelQuery<M>,
): ModelQuery<M> {
  const model = (query as unknown as { model: ModelClass }).model;
  if (!modelHasLocalScopes(model)) return query;
  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop === MODEL_QUERY_TARGET) {
        return target;
      }
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            const result = (value as (...a: unknown[]) => unknown).apply(
              target,
              args,
            );
            // Re-wrap ModelQuery results (e.g. clone) so scopes stay available.
            if (result instanceof ModelQuery && result !== target) {
              return withLocalScopeProxy(result as ModelQuery<M>);
            }
            return result === target ? receiver : result;
          };
        }
        return value;
      }
      const scopeModel = (target as unknown as { model: ModelClass }).model;
      const scopeName = `scope${String(prop).charAt(0).toUpperCase()}${String(prop).slice(1)}`;
      const fn = (scopeModel as unknown as Record<string, unknown>)[scopeName];
      if (typeof fn === "function") {
        return (...args: unknown[]) => {
          (fn as (q: ModelQuery<M>, ...a: unknown[]) => void).call(
            scopeModel,
            target,
            ...args,
          );
          return receiver;
        };
      }
      return undefined;
    },
  }) as ModelQuery<M>;
}
const noCastsCache = new WeakMap<ModelClass, boolean>();
const castsResultCache = new WeakMap<
  ModelClass,
  Record<string, CastDefinition>
>();
const hashedColumnsCache = new WeakMap<ModelClass, string[]>();
const castShapeCache = new WeakMap<
  ModelClass,
  { keys: string[]; force: boolean } | null
>();

/** Reuse DatabaseManager per Connection — avoids `new Db()` on every list build. */
const dbManagerByConnection = new WeakMap<Connection, DatabaseManager>();


function classHasNoCasts(ctor: ModelClass): boolean {
  const cached = noCastsCache.get(ctor);
  if (cached !== undefined) return cached;
  const casts = ctor.getCasts();
  let empty = true;
  for (const _ in casts) {
    empty = false;
    break;
  }
  noCastsCache.set(ctor, empty);
  return empty;
}

/** True when this row must run get-casts (a cast column is present, or an accessor always runs). */
function rowNeedsCasts(
  ctor: ModelClass,
  attributes: Record<string, unknown>,
): boolean {
  let shape = castShapeCache.get(ctor);
  if (shape === undefined) {
    const casts = ctor.getCasts();
    const keys: string[] = [];
    let force = false;
    for (const key in casts) {
      keys.push(key);
      const definition = casts[key];
      if (isAttribute(definition) && definition.get) force = true;
    }
    shape = keys.length === 0 ? null : { keys, force };
    castShapeCache.set(ctor, shape);
  }
  if (shape == null) return false;
  if (shape.force) return true;
  for (const key of shape.keys) {
    if (attributes[key] !== undefined) return true;
  }
  return false;
}

/** True when hydrating this row must run cast getters (partial selects often do not). */
export function attributesNeedModelCasts(
  ctor: ModelClass,
  attributes: Record<string, unknown>,
): boolean {
  return rowNeedsCasts(ctor, attributes);
}

/**
 * Incrementing integer keys (`keyType` `int`) become numbers.
 * Postgres BIGINT often arrives as a string; UUID / `keyType` `string` is left as-is.
 * An explicit `casts` entry for the primary key wins.
 */
function applyIncrementingKeyType(
  ctor: typeof Model,
  attrs: Record<string, unknown>,
  hasExplicitCasts: boolean,
): void {
  if (ctor.incrementing === false) return;
  const key = ctor.primaryKey;
  if (!(key in attrs) || attrs[key] == null) return;
  if (hasExplicitCasts && ctor.getCasts()[key]) return;
  const value = attrs[key];
  if (ctor.keyType === "string") {
    if (typeof value !== "string") attrs[key] = String(value);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    attrs[key] = Math.trunc(value);
    return;
  }
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  if (Number.isSafeInteger(n)) {
    attrs[key] = n;
  }
}

/** Faster than Object.assign onto class instances with private fields (Bun). */
function assignOwn(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key in source) {
    target[key] = source[key];
  }
}

const relationNamesCache = new WeakMap<ModelClass, Set<string>>();

function relationNames(ctor: ModelClass): Set<string> {
  const cached = relationNamesCache.get(ctor);
  if (cached) return cached;
  const raw = ctor.relations;
  const map = typeof raw === "function" ? raw.call(ctor) : raw;
  const names = map != null ? new Set(Object.keys(map)) : new Set<string>();
  relationNamesCache.set(ctor, names);
  return names;
}

function isModelInstance(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { getDirty?: unknown }).getDirty === "function" &&
    typeof (value as { save?: unknown }).save === "function"
  );
}

function isRelationValue(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Collection || isModelInstance(value)) return true;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item instanceof Collection || isModelInstance(item)) return true;
    }
  }
  return false;
}

/** Column attributes only — skip eager-loaded relations and related model bags. */
function persistableAttributes(
  ctor: ModelClass,
  bag: Record<string, unknown>,
  omitKey?: string,
): Record<string, unknown> {
  const relations = relationNames(ctor);
  const casts = ctor.getCasts();
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(bag)) {
    if (omitKey != null && key === omitKey) continue;
    if (key === "pivot") continue;
    if (relations.has(key)) continue;
    const value = bag[key];
    // A cast column holds a Collection or object on purpose (`tags: "collection"`); only
    // uncast values that look like loaded relations are skipped.
    if (!(key in casts) && (typeof value === "function" || isRelationValue(value))) continue;
    out[key] = value;
  }
  return out;
}

const findSqlCache = new WeakMap<
  ModelClass,
  { sql: string; conn: Connection }
>();

export function canFastFind(ctor: ModelClass): boolean {
  if (usesSoftDeletes(ctor) || hasGlobalScopes(ctor)) return false;
  if (hasModelEventListeners(ctor, "retrieved")) return false;
  const conn = ctor.getConnection();
  return (
    typeof conn.getSync1 === "function" || typeof conn.getSync === "function"
  );
}

function canPersistSync(ctor: ModelClass, conn: Connection): boolean {
  return (
    typeof conn.insertGetIdSync === "function" &&
    typeof conn.runSync === "function" &&
    !hasAnyModelEventListeners(ctor)
  );
}

/**
 * Active Record model — familiar query/relation APIs for app code.
 */
export class Model {
  static table: string;
  static primaryKey = "id";
  /**
   * `$incrementing` — false for UUID / ULID / assigned keys.
   * When false, `save()` inserts the primary key instead of `insertGetId`.
   */
  static incrementing = true;
  /** `$keyType` (`int` | `string`). */
  static keyType: "int" | "string" = "int";
  /** Connection name (`"secondary"`) or Connection handle. */
  static connection?: string | Connection;
  /** SoftDeletes stand-in (`@SoftDeletes()` sets this). */
  static softDeletes = false;
  static deletedAt = "deleted_at";
  /** Set by `@HasFactory(...)` — call `Model.factory().create()`. */
  static factory?: () => import("./factory.ts").Factory<any>;
  /** When false, `save()` skips `created_at` / `updated_at`. */
  static timestamps = true;
  /**
   * `$casts` property — prefer `static casts()` when adding enums / Attribute.
   * May be a plain object or a method returning the map.
   */
  static casts: Record<string, CastDefinition> | (() => Record<string, CastDefinition>) =
    {};
  /**
   * Relation definitions. Prefer this over instance methods so you can
   * `declare product: Product | null` and use `model.product` after eager load,
   * with `model.related('product')` for the relation query.
   */
  static relations: RelationsMap = {};
  /**
   * `$touches` — relation names whose related models get `touch()` after
   * this model is saved (or soft-deleted). Honor `withoutTouching`.
   */
  static touches: string[] = [];
  /** `$hidden`. */
  static hidden: string[] = [];
  /** `$visible` allow-list (empty = all non-hidden). */
  static visible: string[] = [];
  /** `$appends` — accessors included in `toArray()`. */
  static appends: string[] = [];
  /** `$fillable`. */
  static fillable: readonly string[] | string[] = [];
  /** `$guarded` — default guard all until fillable is set. */
  static guarded: readonly string[] | string[] = ["*"];

  declare id: string | number;

  /** Set in constructor / hydrate — avoid empty `{}` alloc before assign. */
  #original!: Record<string, unknown>;
  /** Lazy: allocated on first mutation tracking. */
  #changes: Record<string, unknown> | undefined;
  #previous: Record<string, unknown> | undefined;
  #wasRecentlyCreated = false;
  /**
   * Whether this instance is persisted (`$exists`).
   * Not derived from primary key — non-incrementing models assign UUIDs before insert.
   */
  #exists = false;
  #appends: string[] | null = null;
  #hidden: string[] | null = null;
  #visible: string[] | null = null;
  /** Per-instance connection override (`$model->setConnection()`). */
  #connection: string | Connection | undefined;

  /** `$exists` — true after retrieve / successful insert. */
  get exists(): boolean {
    return this.#exists;
  }

  set exists(value: boolean) {
    this.#exists = Boolean(value);
  }

  constructor(attributes: Record<string, unknown> = {}) {
    const ctor = this.constructor as typeof Model;
    const self = this as unknown as Record<string, unknown>;
    // Hot path: no casts, or this row omitted every cast column (partial select).
    if (
      classHasNoCasts(ctor as ModelClass) ||
      !rowNeedsCasts(ctor as ModelClass, attributes)
    ) {
      applyIncrementingKeyType(ctor, attributes, false);
      assignOwn(self, attributes);
      this.#original = attributes;
      return;
    }
    const casted = ctor.castAttributes(attributes, "get");
    applyIncrementingKeyType(ctor, casted, true);
    assignOwn(self, casted);
    // Avoid a second own-key scan via syncOriginal()/getAttributes() on hydrate.
    this.#original = { ...casted };
  }

  /**
   * `newFromBuilder` — hydrate a persisted row (sets `$exists`).
   * Used by ModelQuery list/find paths.
   */
  static newFromBuilder<T extends typeof Model>(
    this: T,
    attributes: Record<string, unknown>,
  ): InstanceType<T> {
    const model = new this(attributes) as InstanceType<T>;
    model.#exists = true;
    return model;
  }

  /** Snapshot current attributes as the original set. */
  syncOriginal(): this {
    this.#original = this.getAttributes();
    return this;
  }

  /** Current attribute bag (non-function own properties). */
  getAttributes(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this as object)) {
      const value = (this as unknown as Record<string, unknown>)[key];
      if (typeof value !== "function") out[key] = value;
    }
    return out;
  }

  /**
   * `getAttribute` — throws when `preventAccessingMissingAttributes` is on
   * and the key was not retrieved / does not exist (relations exempt).
   */
  getAttribute(key: string): unknown {
    const self = this as unknown as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(self, key)) {
      return self[key];
    }
    const original = this.#original ?? {};
    if (Object.prototype.hasOwnProperty.call(original, key)) {
      return original[key];
    }
    if (modelsShouldPreventAccessingMissingAttributes()) {
      const ctor = this.constructor as ModelClass;
      const raw = ctor.relations;
      const map = typeof raw === "function" ? raw.call(ctor) : raw;
      let isRelation = map != null && typeof map[key] === "function";
      if (!isRelation) {
        let proto: object | null = Object.getPrototypeOf(this);
        while (proto && proto !== Object.prototype) {
          const desc = Object.getOwnPropertyDescriptor(proto, key);
          if (desc && typeof desc.value === "function") {
            isRelation = true;
            break;
          }
          proto = Object.getPrototypeOf(proto);
        }
      }
      if (!isRelation) {
        throw new MissingAttributeException(
          (ctor as { name?: string }).name ?? "Model",
          key,
        );
      }
    }
    return undefined;
  }

  /** `isDirty`. */
  isDirty(...attributes: string[]): boolean {
    const dirty = this.getDirty();
    if (attributes.length === 0) return Object.keys(dirty).length > 0;
    return attributes.some((key) =>
      Object.prototype.hasOwnProperty.call(dirty, key),
    );
  }

  /** `isClean`. */
  isClean(...attributes: string[]): boolean {
    return !this.isDirty(...attributes);
  }

  /** `getDirty`. */
  getDirty(): Record<string, unknown> {
    const dirty: Record<string, unknown> = {};
    const original = this.#original ?? {};
    for (const [key, value] of Object.entries(this.getAttributes())) {
      if (!Object.is(value, original[key])) dirty[key] = value;
    }
    return dirty;
  }

  /** `getOriginal`. */
  getOriginal(): Record<string, unknown>;
  getOriginal(key: string): unknown;
  getOriginal(key?: string): unknown {
    const original = this.#original ?? {};
    if (key === undefined) return { ...original };
    return original[key];
  }

  /** `getChanges` — attributes changed by the last save. */
  getChanges(): Record<string, unknown> {
    return this.#changes ? { ...this.#changes } : {};
  }

  /** `getPrevious` — original values of the attributes changed by the last save. */
  getPrevious(): Record<string, unknown>;
  getPrevious(key: string): unknown;
  getPrevious(key?: string): unknown {
    const previous = this.#previous ?? {};
    if (key === undefined) return { ...previous };
    return previous[key];
  }

  #capturePrevious(created = false): void {
    const original = this.#original ?? {};
    const previous: Record<string, unknown> = {};
    if (!created) {
      for (const key of Object.keys(this.#changes ?? {})) {
        if (Object.prototype.hasOwnProperty.call(original, key)) {
          previous[key] = original[key];
        }
      }
    }
    this.#previous = previous;
  }

  /** `wasChanged`. */
  wasChanged(...attributes: string[]): boolean {
    const changes = this.#changes;
    if (!changes) return false;
    if (attributes.length === 0) return Object.keys(changes).length > 0;
    return attributes.some((key) =>
      Object.prototype.hasOwnProperty.call(changes, key),
    );
  }

  /** `wasRecentlyCreated`. */
  wasRecentlyCreated(): boolean {
    return this.#wasRecentlyCreated;
  }

  /** `append`. */
  append(...attributes: string[]): this {
    const current = this.getAppends();
    this.#appends = [...new Set([...current, ...attributes.flat()])];
    return this;
  }

  /** `setAppends`. */
  setAppends(attributes: string[]): this {
    this.#appends = [...attributes];
    return this;
  }

  /** `getAppends`. */
  getAppends(): string[] {
    if (this.#appends) return [...this.#appends];
    return [...((this.constructor as ModelClass).appends ?? [])];
  }

  /** `getHidden`. */
  getHidden(): string[] {
    if (this.#hidden) return [...this.#hidden];
    return [...((this.constructor as ModelClass).hidden ?? [])];
  }

  /** `getVisible`. */
  getVisible(): string[] {
    if (this.#visible) return [...this.#visible];
    return [...((this.constructor as ModelClass).visible ?? [])];
  }

  /** `setHidden`. */
  setHidden(attributes: string[]): this {
    this.#hidden = [...attributes];
    return this;
  }

  /** `setVisible`. */
  setVisible(attributes: string[]): this {
    this.#visible = [...attributes];
    return this;
  }

  /** `makeVisible` — show attributes for this instance. */
  makeVisible(...attributes: string[]): this {
    const attrs = attributes.flat();
    const hidden = new Set(this.getHidden());
    for (const key of attrs) hidden.delete(key);
    this.#hidden = [...hidden];
    const visible = this.getVisible();
    if (visible.length > 0) {
      this.#visible = [...new Set([...visible, ...attrs])];
    }
    return this;
  }

  /** `makeHidden` — hide attributes for this instance. */
  makeHidden(...attributes: string[]): this {
    const attrs = attributes.flat();
    this.#hidden = [...new Set([...this.getHidden(), ...attrs])];
    const visible = this.getVisible();
    if (visible.length > 0) {
      const hide = new Set(attrs);
      this.#visible = visible.filter((key) => !hide.has(key));
    }
    return this;
  }

  /**
   * Run a callback without touching timestamps (`Model::withoutTimestamps`).
   */
  static async withoutTimestamps<T>(
    this: typeof Model,
    callback: () => T | Promise<T>,
  ): Promise<T> {
    const previous = this.timestamps;
    this.timestamps = false;
    try {
      return await callback();
    } finally {
      this.timestamps = previous;
    }
  }

  /**
   * `Model::withoutTouching` — skip parent `touch()` while callback runs.
   * Pass model classes to limit which models ignore touch; omit for all.
   */
  static withoutTouching<T>(
    this: typeof Model,
    callback: () => T | Promise<T>,
  ): Promise<T>;
  static withoutTouching<T>(
    this: typeof Model,
    models: Array<typeof Model>,
    callback: () => T | Promise<T>,
  ): Promise<T>;
  static withoutTouching<T>(
    this: typeof Model,
    modelsOrCallback: Array<typeof Model> | (() => T | Promise<T>),
    callback?: () => T | Promise<T>,
  ): Promise<T> {
    return runWithoutTouching(modelsOrCallback as never, callback);
  }

  /** Whether touch is currently suppressed for this model class. */
  static isIgnoringTouch(this: typeof Model): boolean {
    return isIgnoringTouch(this);
  }

  /** `Model::preventLazyLoading`. */
  static preventLazyLoading(prevent = true): void {
    setPreventLazyLoading(prevent);
  }

  /** `Model::preventSilentlyDiscardingAttributes`. */
  static preventSilentlyDiscardingAttributes(prevent = true): void {
    setPreventSilentlyDiscardingAttributes(prevent);
  }

  /** `Model::preventAccessingMissingAttributes`. */
  static preventAccessingMissingAttributes(prevent = true): void {
    setPreventAccessingMissingAttributes(prevent);
  }

  /** `Model::shouldBeStrict` — enable/disable the strictness trio. */
  static shouldBeStrict(should = true): void {
    setShouldBeStrict(should);
  }

  /** `Model::addGlobalScope`. */
  static addGlobalScope(
    this: typeof Model,
    nameOrScope: string | GlobalScopeCallback,
    scope?: GlobalScopeCallback,
  ): void {
    if (typeof nameOrScope === "function") {
      registerGlobalScope(this, nameOrScope.name || `scope_${Date.now()}`, nameOrScope);
      return;
    }
    if (!scope) throw new Error("addGlobalScope requires a callback.");
    registerGlobalScope(this, nameOrScope, scope);
  }

  /** `Model::addGlobalScope` removal helper. */
  static removeGlobalScope(this: typeof Model, name: string): void {
    unregisterGlobalScope(this, name);
  }

  /**
   * `boot` — runs once per model class before first use.
   * Prefer registering listeners in `booted()`.
   */
  static boot(): void {}

  /**
   * `booted` — runs once after `boot`. Typical place for `static::created(...)`.
   */
  static booted(): void {}

  /** Ensure this model class has been booted. */
  static bootIfNotBooted(): void {
    bootIfNotBooted(this);
  }

  /** `Model::observe`. */
  static observe<T extends Model>(
    this: abstract new (...args: never[]) => T,
    observer:
      | ModelObserver<T>
      | (new () => ModelObserver<T>)
      | Array<ModelObserver<T> | (new () => ModelObserver<T>)>,
  ): void {
    observeModel(this, observer);
  }

  /** `Model::withoutEvents`. */
  static withoutEvents<T>(
    this: typeof Model,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    return withoutModelEvents(this, callback);
  }

  static retrieved(callback: ModelEventListener): void {
    registerModelEvent(this, "retrieved", callback);
  }
  static creating(callback: ModelEventListener): void {
    registerModelEvent(this, "creating", callback);
  }
  static created(callback: ModelEventListener): void {
    registerModelEvent(this, "created", callback);
  }
  static updating(callback: ModelEventListener): void {
    registerModelEvent(this, "updating", callback);
  }
  static updated(callback: ModelEventListener): void {
    registerModelEvent(this, "updated", callback);
  }
  static saving(callback: ModelEventListener): void {
    registerModelEvent(this, "saving", callback);
  }
  static saved(callback: ModelEventListener): void {
    registerModelEvent(this, "saved", callback);
  }
  static deleting(callback: ModelEventListener): void {
    registerModelEvent(this, "deleting", callback);
  }
  static deleted(callback: ModelEventListener): void {
    registerModelEvent(this, "deleted", callback);
  }
  static trashed(callback: ModelEventListener): void {
    registerModelEvent(this, "trashed", callback);
  }
  static forceDeleting(callback: ModelEventListener): void {
    registerModelEvent(this, "forceDeleting", callback);
  }
  static forceDeleted(callback: ModelEventListener): void {
    registerModelEvent(this, "forceDeleted", callback);
  }
  static restoring(callback: ModelEventListener): void {
    registerModelEvent(this, "restoring", callback);
  }
  static restored(callback: ModelEventListener): void {
    registerModelEvent(this, "restored", callback);
  }
  static replicating(callback: ModelEventListener): void {
    registerModelEvent(this, "replicating", callback);
  }

  /** Fire a lifecycle event on this instance. */
  fireModelEvent(event: ModelEventName): boolean | Promise<boolean> {
    return fireModelEvent(this, event);
  }

  /** Resolve casts from `casts()` method or `$casts` property. */
  static getCasts(): Record<string, CastDefinition> {
    const cached = castsResultCache.get(this as unknown as ModelClass);
    if (cached) return cached;
    const field = (this as ModelClass).casts;
    const value =
      typeof field === "function" ? (field.call(this) ?? {}) : (field ?? {});
    castsResultCache.set(this as unknown as ModelClass, value);
    return value;
  }

  static castAttributes(
    attributes: Record<string, unknown>,
    direction: "get" | "set",
  ): Record<string, unknown> {
    const casts = this.getCasts();
    let hasCast = false;
    for (const _ in casts) {
      hasCast = true;
      break;
    }
    if (!hasCast) {
      return attributes;
    }
    const driver =
      (this.connection != null
        ? resolveConnection(this.connection)
        : defaultConnection
      )?.driver;
    let out = { ...attributes };
    for (const [key, definition] of Object.entries(casts)) {
      if (isAttribute(definition)) {
        if (direction === "get") {
          if (!(key in out) && definition.get === undefined) continue;
          if (definition.get) {
            out[key] = definition.get(out[key], out);
          }
        } else if (definition.set && key in out) {
          const result = definition.set(out[key], out);
          delete out[key];
          if (
            result !== null &&
            typeof result === "object" &&
            !Array.isArray(result) &&
            !(result instanceof Date)
          ) {
            out = { ...out, ...(result as Record<string, unknown>) };
          } else {
            out[key] = result;
          }
        }
        continue;
      }

      if (!(key in out) || out[key] === undefined) continue;

      if (isCastType(definition)) {
        out[key] =
          direction === "get"
            ? castFromStorage(out[key], definition)
            : castToStorage(out[key], definition, driver);
        continue;
      }

      if (isEnumCast(definition)) {
        out[key] =
          direction === "get"
            ? enumFromStorage(out[key], definition)
            : enumToStorage(out[key], definition);
      }
    }
    return out;
  }

  static setConnection(connection: Connection): void {
    defaultConnection = connection;
    const name = connection.getName() || "default";
    setDefaultConnection(connection, name);
  }

  static getConnection(): Connection {
    return resolveConnection(this.connection);
  }

  /** `$model->setConnection($name)`. */
  setConnection(connection: string | Connection): this {
    this.#connection = connection;
    return this;
  }

  /** Active connection for this instance (instance override → model → default). */
  getConnection(): Connection {
    const ctor = this.constructor as typeof Model;
    return resolveConnection(this.#connection ?? ctor.connection);
  }

  static db(): DatabaseManager {
    const conn = this.getConnection();
    let manager = dbManagerByConnection.get(conn);
    if (!manager) {
      manager = new Db(conn);
      dbManagerByConnection.set(conn, manager);
    }
    return manager;
  }

  /**
   * `Model::on($connection)` — same model, different named connection.
   */
  static on<T extends typeof Model>(
    this: T,
    connection: string,
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({ connection });
  }

  /**
   * Create a model query (honors `@UseBuilder` when present).
   * Local scopes (`scopeActive` → `.active()`) are available via proxy.
   */
  static newQuery<T extends typeof Model>(
    this: T,
    options?: ModelQueryOptions,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    type Builder = new (
      model: ModelClass,
      options?: ModelQueryOptions,
    ) => ModelQuery<InstanceType<T>>;
    const Ctor = (resolveModelBuilder(this) ?? ModelQuery) as unknown as Builder;
    const query = new Ctor(this as ModelClass, options);
    return withLocalScopeProxy(query);
  }

  /** `withoutGlobalScopes()`. */
  static withoutGlobalScopes<T extends typeof Model>(
    this: T,
    names?: string[],
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({
      withoutGlobalScopes: names ?? true,
    });
  }

  /** `withoutGlobalScope($name)`. */
  static withoutGlobalScope<T extends typeof Model>(
    this: T,
    name: string,
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({ withoutGlobalScopes: [name] });
  }

  /** `Model::query()` — scoped `ModelQuery` (not a raw table builder). */
  static query<T extends typeof Model>(
    this: T,
    options?: ModelQueryOptions,
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery(options);
  }

  /** `Model::find`. */
  static find<T extends typeof Model>(
    this: T,
    id: string | number,
  ): InstanceType<T> | null | Promise<InstanceType<T> | null> {
    this.bootIfNotBooted();
    if (canFastFind(this as unknown as ModelClass)) {
      // `.call` is required so subclasses can use Model's #fastFind; assert InstanceType<T>.
      return Model.#fastFind.call(this, id) as InstanceType<T> | null;
    }
    return this.newQuery()
      .where(this.primaryKey, id)
      .first();
  }

  /** `getRouteKeyName()` — column used for implicit route binding. */
  static getRouteKeyName(): string {
    return this.primaryKey;
  }

  /**
   * `resolveRouteBinding` — find by PK or custom `{param:column}` field.
   */
  static resolveRouteBinding<T extends typeof Model>(
    this: T,
    value: string | number,
    field?: string,
  ): InstanceType<T> | null | Promise<InstanceType<T> | null> {
    const column = field ?? this.getRouteKeyName();
    if (column === this.primaryKey) {
      return this.find(value);
    }
    this.bootIfNotBooted();
    return this.newQuery().where(column, value).first();
  }

  /**
   * `resolveSoftDeletableRouteBinding` — same as
   * `resolveRouteBinding` but includes soft-deleted rows (`withTrashed()`).
   * Used by the router when the route opts in via `withTrashed()`.
   */
  static resolveSoftDeletableRouteBinding<T extends typeof Model>(
    this: T,
    value: string | number,
    field?: string,
  ): InstanceType<T> | null | Promise<InstanceType<T> | null> {
    const column = field ?? this.getRouteKeyName();
    this.bootIfNotBooted();
    return this.newQuery({ withTrashed: true }).where(column, value).first();
  }

  static #fastFind<T extends typeof Model>(
    this: T,
    id: string | number,
  ): InstanceType<T> | null {
    const conn = this.getConnection();
    let cached = findSqlCache.get(this as unknown as ModelClass);
    if (!cached || cached.conn !== conn) {
      const table = wrapSqlName(conn.dialect, this.table);
      const pk = wrapSqlName(conn.dialect, this.primaryKey);
      cached = {
        sql: `SELECT * FROM ${table} WHERE ${pk} = ? LIMIT 1`,
        conn,
      };
      findSqlCache.set(this as unknown as ModelClass, cached);
    }
    const row = conn.getSync1
      ? conn.getSync1(cached.sql, id)
      : conn.getSync!(cached.sql, [id]);
    if (!row) return null;
    const model = new this(row) as InstanceType<T>;
    model.#exists = true;
    return model;
  }

  /** `Model::findOrFail`. */
  static async findOrFail<T extends typeof Model>(
    this: T,
    id: string | number,
  ): Promise<InstanceType<T>> {
    const model = await this.find(id);
    if (!model) throw new ModelNotFoundException();
    return model;
  }

  /** `Model::all`. */
  static async all<T extends typeof Model>(
    this: T,
  ): Promise<OrmCollection<InstanceType<T>>> {
    this.bootIfNotBooted();
    return this.newQuery().get();
  }

  /**
   * `Model::get` — same as `query().get()` / `all()`.
   * Typed helper for autocomplete; Proxy also forwards other terminals.
   */
  static get<T extends typeof Model>(
    this: T,
  ): OrmCollection<InstanceType<T>> | Promise<OrmCollection<InstanceType<T>>> {
    this.bootIfNotBooted();
    return this.newQuery().get();
  }

  /**
   * `Model::pluck($column, $key = null)`.
   * One column → list Collection; with `key` → keyed Record (see Collection.pluck).
   */
  static pluck<T extends typeof Model>(
    this: T,
    column: string,
  ): Promise<Collection<unknown>>;
  static pluck<T extends typeof Model>(
    this: T,
    column: string,
    key: string,
  ): Promise<Record<string, unknown>>;
  static pluck<T extends typeof Model>(
    this: T,
    column: string,
    key?: string,
  ): Promise<Collection<unknown> | Record<string, unknown>> {
    this.bootIfNotBooted();
    if (key === undefined) return this.newQuery().pluck(column);
    return this.newQuery().pluck(column, key);
  }

  /** SQLite-only sync `all()` — see `ModelQuery.getSync`. */
  static allSync<T extends typeof Model>(
    this: T,
  ): OrmCollection<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().getSync();
  }

  /** SQLite-only sync `find` — see `ModelQuery.firstSync`. */
  static findSync<T extends typeof Model>(
    this: T,
    id: string | number,
  ): InstanceType<T> | null {
    this.bootIfNotBooted();
    return this.newQuery().findSync(id);
  }

  /** `Model::where`. */
  static where<T extends typeof Model>(
    this: T,
    callback: (query: ModelQuery<InstanceType<T>>) => void,
  ): ModelQuery<InstanceType<T>>;
  static where<T extends typeof Model>(
    this: T,
    column: string,
    value: unknown,
  ): ModelQuery<InstanceType<T>>;
  static where<T extends typeof Model>(
    this: T,
    column: string,
    op: string,
    value: unknown,
  ): ModelQuery<InstanceType<T>>;
  static where<T extends typeof Model>(
    this: T,
    columnOrCallback: string | ((query: ModelQuery<InstanceType<T>>) => void),
    opOrValue?: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    const q = this.newQuery();
    if (typeof columnOrCallback === "function") {
      return q.where(columnOrCallback);
    }
    if (value === undefined) return q.where(columnOrCallback, opOrValue);
    return q.where(columnOrCallback, String(opOrValue), value);
  }

  /** Karobar-style multi-column LIKE search. */
  static search<T extends typeof Model>(
    this: T,
    columns: string[],
    term: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().search(columns, term);
  }

  /** Start a new query and forward common builder methods (`__callStatic`). */
  static orWhere<T extends typeof Model>(
    this: T,
    column: string,
    value: unknown,
  ): ModelQuery<InstanceType<T>>;
  static orWhere<T extends typeof Model>(
    this: T,
    column: string,
    op: string,
    value: unknown,
  ): ModelQuery<InstanceType<T>>;
  static orWhere<T extends typeof Model>(
    this: T,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    const q = this.newQuery();
    if (value === undefined) return q.orWhere(column, opOrValue);
    return q.orWhere(column, String(opOrValue), value);
  }

  static whereIn<T extends typeof Model>(
    this: T,
    column: string,
    values: unknown[],
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereIn(column, values);
  }

  static whereNull<T extends typeof Model>(
    this: T,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereNull(column);
  }

  static whereNotNull<T extends typeof Model>(
    this: T,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereNotNull(column);
  }

  static orderBy<T extends typeof Model>(
    this: T,
    column: string,
    direction: "asc" | "desc" = "asc",
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().orderBy(column, direction);
  }

  static orderByDesc<T extends typeof Model>(
    this: T,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    return this.orderBy(column, "desc");
  }

  static orderByRaw<T extends typeof Model>(
    this: T,
    sql: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().orderByRaw(sql);
  }

  /** Karobar alias for `orderByRaw`. */
  static orderBySql<T extends typeof Model>(
    this: T,
    sql: string,
  ): ModelQuery<InstanceType<T>> {
    return this.orderByRaw(sql);
  }

  static latest<T extends typeof Model>(
    this: T,
    column = "created_at",
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().latest(column);
  }

  static oldest<T extends typeof Model>(
    this: T,
    column = "created_at",
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().oldest(column);
  }

  static limit<T extends typeof Model>(
    this: T,
    value: number,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().limit(value);
  }

  static take<T extends typeof Model>(
    this: T,
    value: number,
  ): ModelQuery<InstanceType<T>> {
    return this.limit(value);
  }

  static select<T extends typeof Model>(
    this: T,
    ...columns: string[]
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().select(...columns);
  }

  /** `Model::whereDate`. */
  static whereDate<T extends typeof Model>(
    this: T,
    column: string,
    value: DateInput,
  ): ModelQuery<InstanceType<T>>;
  static whereDate<T extends typeof Model>(
    this: T,
    column: string,
    op: string,
    value: DateInput,
  ): ModelQuery<InstanceType<T>>;
  static whereDate<T extends typeof Model>(
    this: T,
    column: string,
    opOrValue: string | DateInput,
    value?: DateInput,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    const q = this.newQuery();
    if (value === undefined) return q.whereDate(column, opOrValue as DateInput);
    return q.whereDate(column, String(opOrValue), value);
  }

  /** `Model::whereNot(closure)`. */
  static whereNot<T extends typeof Model>(
    this: T,
    callback: (query: ModelQuery<InstanceType<T>>) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereNot(callback);
  }

  /** `Model::orWhereNot(closure)`. */
  static orWhereNot<T extends typeof Model>(
    this: T,
    callback: (query: ModelQuery<InstanceType<T>>) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().orWhereNot(callback);
  }

  /** `withTrashed()`. */
  static withTrashed<T extends typeof Model>(
    this: T,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery({
      withTrashed: true,
    });
  }

  /** `onlyTrashed()`. */
  static onlyTrashed<T extends typeof Model>(
    this: T,
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({
      onlyTrashed: true,
    });
  }

  /** `withoutTrashed()`. */
  static withoutTrashed<T extends typeof Model>(
    this: T,
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({
      withTrashed: false,
      onlyTrashed: false,
    });
  }

  /** `get()` returns plain row objects. Models are not built. */
  static rows<T extends typeof Model>(
    this: T,
  ): ModelQuery<InstanceType<T>, "row"> {
    return this.newQuery().rows();
  }

  /** Eager-load relations (`with('posts')`, `with({ posts: (q) => q.where(…) })`). */
  static with<T extends typeof Model>(
    this: T,
    ...relations: Array<string | string[] | Record<string, unknown>>
  ): ModelQuery<InstanceType<T>> {
    return this.newQuery({
      eagerLoad: normalizeWithRelations(relations),
    });
  }

  /** `Model::whereHas`. */
  static whereHas<T extends typeof Model>(
    this: T,
    relation: string,
    callback?: (query: ModelQuery) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereHas(relation, callback);
  }

  /** `Model::whereDoesntHave`. */
  static whereDoesntHave<T extends typeof Model>(
    this: T,
    relation: string,
    callback?: (query: ModelQuery) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereDoesntHave(relation, callback);
  }

  /** `Model::orWhereHas`. */
  static orWhereHas<T extends typeof Model>(
    this: T,
    relation: string,
    callback?: (query: ModelQuery) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().orWhereHas(relation, callback);
  }

  /** `Model::whereRelation`. */
  static whereRelation<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereRelation(relation, column, opOrValue, value);
  }

  /** `Model::orWhereRelation`. */
  static orWhereRelation<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().orWhereRelation(relation, column, opOrValue, value);
  }

  /** `withCount` — `'posts'`, `'posts as post_total'`, a string list, or `{ products: { as: 'productsCount' } }`. */
  static withCount<T extends typeof Model>(
    this: T,
    ...relations: Array<
      | string
      | string[]
      | Record<string, unknown>
    >
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withCount(
      ...(relations as Parameters<ModelQuery["withCount"]>),
    );
  }

  /** `Model::withSum`. */
  static withSum<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withSum(relation, column);
  }

  static withAvg<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withAvg(relation, column);
  }

  static withMin<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withMin(relation, column);
  }

  static withMax<T extends typeof Model>(
    this: T,
    relation: string,
    column: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withMax(relation, column);
  }

  static withExists<T extends typeof Model>(
    this: T,
    ...relations: string[]
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withExists(...relations);
  }

  static withWhereHas<T extends typeof Model>(
    this: T,
    relation: string,
    callback?: (query: ModelQuery) => void,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().withWhereHas(relation, callback);
  }

  static whereBelongsTo<T extends typeof Model>(
    this: T,
    related: Model,
    relationName?: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereBelongsTo(related, relationName);
  }

  static whereAny<T extends typeof Model>(
    this: T,
    columns: string[],
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereAny(columns, opOrValue, value);
  }

  static whereAll<T extends typeof Model>(
    this: T,
    columns: string[],
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereAll(columns, opOrValue, value);
  }

  static whereNone<T extends typeof Model>(
    this: T,
    columns: string[],
    opOrValue: unknown,
    value?: unknown,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereNone(columns, opOrValue, value);
  }

  static whereKey<T extends typeof Model>(
    this: T,
    id: string | number | Array<string | number>,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereKey(id);
  }

  /** `Model::whereUuid`. */
  static whereUuid<T extends typeof Model>(
    this: T,
    column: string,
    value: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereUuid(column, value);
  }

  /** `Model::whereUlid`. */
  static whereUlid<T extends typeof Model>(
    this: T,
    column: string,
    value: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().whereUlid(column, value);
  }

  /** `Model::join`. */
  static join<T extends typeof Model>(
    this: T,
    table: string,
    first: string,
    op: string,
    second: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().join(table, first, op, second);
  }

  /** `Model::leftJoin`. */
  static leftJoin<T extends typeof Model>(
    this: T,
    table: string,
    first: string,
    op: string,
    second: string,
  ): ModelQuery<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.newQuery().leftJoin(table, first, op, second);
  }

  /** `Model::paginate`. */
  static async paginate<T extends typeof Model>(
    this: T,
    perPage = 15,
    page?: number,
    options: { path?: string; pageName?: string } = {},
  ): Promise<LengthAwarePaginator<InstanceType<T>>> {
    return this.newQuery().paginate(
      perPage,
      page,
      options,
    );
  }

  /** `Model::cursorPaginate`. */
  static async cursorPaginate<T extends typeof Model>(
    this: T,
    perPage = 15,
    cursor: string | null = null,
    options: { path?: string; cursorName?: string } = {},
  ): Promise<CursorPaginator<InstanceType<T>>> {
    return this.newQuery().cursorPaginate(
      perPage,
      cursor,
      options,
    );
  }

  /** `Model::cursor()`: stream models from a single query. */
  static cursor<T extends typeof Model>(
    this: T,
    chunkSize?: number,
  ): LazyCollection<InstanceType<T>> {
    return this.newQuery().cursor(chunkSize);
  }

  /** `Model::lazy()`: chunked iteration, one query per chunk. */
  static lazy<T extends typeof Model>(
    this: T,
    chunkSize?: number,
  ): LazyCollection<InstanceType<T>> {
    return this.newQuery().lazy(chunkSize);
  }

  /** `Model::lazyById()`: chunked iteration by primary key (safe while updating). */
  static lazyById<T extends typeof Model>(
    this: T,
    chunkSize?: number,
    column?: string,
  ): LazyCollection<InstanceType<T>> {
    return this.newQuery().lazyById(chunkSize, column);
  }

  /** `Model::lazyByIdDesc()`. */
  static lazyByIdDesc<T extends typeof Model>(
    this: T,
    chunkSize?: number,
    column?: string,
  ): LazyCollection<InstanceType<T>> {
    return this.newQuery().lazyByIdDesc(chunkSize, column);
  }

  /** `Model::create` (respects `$fillable` / `$guarded`). */
  static create<T extends typeof Model>(
    this: T,
    attributes: Record<string, unknown>,
  ): InstanceType<T> | Promise<InstanceType<T>> {
    this.bootIfNotBooted();
    return this.forceCreate(filterFillable(this as ModelClass, attributes));
  }

  /** `Model::forceCreate` — insert every given attribute, ignoring `$fillable`. */
  static forceCreate<T extends typeof Model>(
    this: T,
    useAttrs: Record<string, unknown>,
  ): InstanceType<T> | Promise<InstanceType<T>> {
    this.bootIfNotBooted();
    // Assign raw attributes (skip get-casts) so mutators like Attribute.set can run on save.
    const model = classHasNoCasts(this as unknown as ModelClass)
      ? (new this(useAttrs) as InstanceType<T>)
      : Object.assign(new this() as InstanceType<T>, useAttrs);
    const saved = model.save();
    const after = (
      row: InstanceType<T>,
    ): InstanceType<T> | Promise<InstanceType<T>> => {
      if (classHasNoCasts(this as unknown as ModelClass)) {
        return row;
      }
      const key = this.primaryKey;
      const id = (row as unknown as Record<string, unknown>)[key] as
        | string
        | number;
      // Re-hydrate get-casts from storage (same end state as insert + find).
      const fresh = this.withoutEvents(() => this.find(id));
      const use = (found: InstanceType<T> | null) => {
        if (found) {
          (found as Model).#wasRecentlyCreated = true;
          return found;
        }
        return row;
      };
      if (fresh instanceof Promise) {
        return fresh.then(use);
      }
      return use(fresh);
    };
    if (saved instanceof Promise) {
      return saved.then(after);
    }
    return after(saved);
  }

  /** `firstOrNew`. */
  static async firstOrNew<T extends typeof Model>(
    this: T,
    attributes: Record<string, unknown>,
    values: Record<string, unknown> = {},
  ): Promise<InstanceType<T>> {
    let q = this.newQuery();
    for (const [column, value] of Object.entries(attributes)) {
      q = q.where(column, value);
    }
    const existing = await q.first();
    if (existing) return existing;
    return new this({ ...attributes, ...values }) as InstanceType<T>;
  }

  /** `firstOrCreate`. */
  static async firstOrCreate<T extends typeof Model>(
    this: T,
    attributes: Record<string, unknown>,
    values: Record<string, unknown> = {},
  ): Promise<InstanceType<T>> {
    let q = this.newQuery();
    for (const [column, value] of Object.entries(attributes)) {
      q = q.where(column, value);
    }
    const existing = await q.first();
    if (existing) return existing;
    return this.create({ ...attributes, ...values });
  }

  /** `updateOrCreate`. */
  static async updateOrCreate<T extends typeof Model>(
    this: T,
    attributes: Record<string, unknown>,
    values: Record<string, unknown> = {},
  ): Promise<InstanceType<T>> {
    let q = this.newQuery();
    for (const [column, value] of Object.entries(attributes)) {
      q = q.where(column, value);
    }
    const existing = await q.first();
    if (existing) {
      await existing.update(values);
      return existing;
    }
    return this.create({ ...attributes, ...values });
  }

  /**
   * Bulk insert. Delegates to `ModelQuery.insert` (timestamps stamped when enabled).
   * Does not fire creating/created events — set tenant/client ids on the rows.
   */
  static async insert<T extends typeof Model>(
    this: T,
    values: Record<string, unknown> | Record<string, unknown>[],
  ): Promise<boolean> {
    this.bootIfNotBooted();
    return this.newQuery().insert(values);
  }

  /**
   * `Model::upsert` — bulk insert-or-update on unique conflict.
   * Delegates to `ModelQuery.upsert` (timestamps stamped when enabled).
   */
  static async upsert<T extends typeof Model>(
    this: T,
    values: Record<string, unknown> | Record<string, unknown>[],
    uniqueBy: string | string[],
    update: string[] | null = null,
  ): Promise<number> {
    this.bootIfNotBooted();
    return this.newQuery().upsert(values, uniqueBy, update);
  }

  /** `$model->fill($attributes)`. */
  fill(attributes: Record<string, unknown>): this {
    const ctor = this.constructor as ModelClass;
    const finalAttrs = filterFillable(ctor, attributes);
    assignOwn(
      this as unknown as Record<string, unknown>,
      ctor.castAttributes(finalAttrs, "get"),
    );
    return this;
  }

  /** `$model->update($attributes)`. */
  async update(attributes: Record<string, unknown>): Promise<this> {
    this.fill(attributes);
    await this.save();
    return this;
  }

  save(): this | Promise<this> {
    const ctor = this.constructor as typeof Model;
    ctor.bootIfNotBooted();
    if (!classHasNoCasts(ctor as unknown as ModelClass)) {
      const pending = this.#pendingHashes(ctor as unknown as ModelClass);
      if (pending.length > 0) return this.#hashThenSave(pending);
    }
    const conn = this.getConnection();
    if (canPersistSync(ctor as unknown as ModelClass, conn)) {
      return this.#persistSync(conn);
    }
    return this.#persistAsync();
  }

  /** `hashed` cast columns that hold a plain string, so `save()` can hash them off the event loop. */
  #pendingHashes(ctor: ModelClass): string[] {
    let columns = hashedColumnsCache.get(ctor);
    if (!columns) {
      const casts = ctor.getCasts();
      columns = Object.keys(casts).filter((key) => casts[key] === "hashed");
      hashedColumnsCache.set(ctor, columns);
    }
    if (columns.length === 0) return columns;
    const row = this as unknown as Record<string, unknown>;
    return columns.filter((key) => {
      const value = row[key];
      return typeof value === "string" && value !== "" && !isAlreadyHashed(value);
    });
  }

  async #hashThenSave(columns: string[]): Promise<this> {
    const row = this as unknown as Record<string, unknown>;
    const hashes = await Promise.all(
      columns.map((key) => hashCastValue(String(row[key]))),
    );
    columns.forEach((key, i) => {
      row[key] = hashes[i];
    });
    return this.save();
  }

  #persistSync(conn: Connection): this {
    const ctor = this.constructor as typeof Model;
    const key = ctor.primaryKey;
    const row = this as unknown as Record<string, unknown>;
    const id = row[key];
    const exists = this.#exists;
    const dialect = conn.dialect;
    const table = ctor.table;
    const incrementing = ctor.incrementing !== false;

    const usesTimestamps = ctor.timestamps !== false;
    if (usesTimestamps) {
      const now = nowForConnection(conn);
      row.updated_at = now;
      if (!exists) {
        row.created_at = row.created_at ?? now;
      }
    }

    if (!exists) {
      const noCasts = classHasNoCasts(ctor as unknown as ModelClass);
      const cachedCols = noCasts
        ? cachedSyncInsertColumns(ctor as unknown as ModelClass)
        : null;
      let writeColumns: string[];
      let writeValues: unknown[];
      if (cachedCols) {
        writeColumns = cachedCols;
        const n = cachedCols.length;
        if (n === 1) {
          writeValues = persistValueScratch;
          persistValueScratch[0] = row[cachedCols[0]!];
          persistValueScratch.length = 1;
        } else {
          writeValues = persistValueScratch;
          persistValueScratch.length = n;
          for (let i = 0; i < n; i++) {
            persistValueScratch[i] = row[cachedCols[i]!];
          }
        }
      } else {
        const persistBag = persistableAttributes(
          ctor as unknown as ModelClass,
          row,
          incrementing || row[key] == null ? key : undefined,
        );
        writeColumns = Object.keys(persistBag);
        writeValues = Object.values(persistBag);
        if (!noCasts) {
          const payload = ctor.castAttributes(persistBag, "set");
          writeColumns = Object.keys(payload);
          writeValues = Object.values(payload);
        }
      }
      const inserted = withoutQueryWriteHook(() => {
        if (incrementing) {
          if (writeColumns.length === 1 && conn.insertGetIdSync1) {
            return conn.insertGetIdSync1(
              table,
              writeColumns[0]!,
              writeValues[0],
            );
          }
          return conn.insertGetIdSync!(table, writeColumns, writeValues);
        }
        const placeholders = writeColumns.map(() => "?").join(", ");
        const wrapped = writeColumns.map((c) => wrapSqlName(dialect, c));
        conn.runSync!(
          `INSERT INTO ${table} (${wrapped.join(", ")}) VALUES (${placeholders})`,
          writeValues,
        );
        return null;
      });
      if (incrementing) {
        row[key] = inserted;
        applyIncrementingKeyType(ctor, row, !noCasts);
      }
      this.#exists = true;
      this.#wasRecentlyCreated = true;
      const original: Record<string, unknown> = {};
      if (cachedCols) {
        for (let i = 0; i < cachedCols.length; i++) {
          const col = cachedCols[i]!;
          original[col] = row[col];
        }
        if (incrementing) original[key] = row[key];
      } else {
        for (const attr of Object.keys(row)) {
          const value = row[attr];
          if (typeof value !== "function") original[attr] = value;
        }
      }
      this.#original = original;
      this.#changes = original;
      this.#previous = undefined;
      this.#touchOwnersSync();
      return this;
    }

    const dirty = this.getDirty();
    const attributes = persistableAttributes(
      ctor as unknown as ModelClass,
      dirty,
      key,
    );
    const payload = ctor.castAttributes(attributes, "set");
    const columns = Object.keys(payload);
    if (columns.length > 0) {
      const sets = columns
        .map((c) => `${wrapSqlName(dialect, c)} = ?`)
        .join(", ");
      withoutQueryWriteHook(() =>
        conn.runSync!(
          `UPDATE ${table} SET ${sets} WHERE ${wrapSqlName(dialect, key)} = ?`,
          [...Object.values(payload), id],
        ),
      );
    }
    this.#wasRecentlyCreated = false;
    this.#changes = dirty;
    this.#capturePrevious();
    this.syncOriginal();
    this.#touchOwnersSync();
    return this;
  }

  async #persistAsync(): Promise<this> {
    const ctor = this.constructor as typeof Model;
    const key = ctor.primaryKey;
    const row = this as unknown as Record<string, unknown>;
    const id = row[key];
    const exists = this.#exists;

    if ((await fireModelEvent(this, "saving")) === false) return this;

    const usesTimestamps = ctor.timestamps !== false;
    if (usesTimestamps) {
      const now = nowForConnection(this.getConnection());
      row.updated_at = now;
      if (!exists) {
        row.created_at = row.created_at ?? now;
      }
    }

    const dirty = this.getDirty();
    const persistCtor = ctor as unknown as ModelClass;

    const table = new Db(this.getConnection()).table(ctor.table);

    if (!exists) {
      if ((await fireModelEvent(this, "creating")) === false) return this;
      const attributes = persistableAttributes(
        persistCtor,
        row,
        ctor.incrementing !== false || row[key] == null ? key : undefined,
      );
      if (ctor.incrementing !== false) {
        const newId = await withoutQueryWriteHook(() =>
          table.insertGetId(ctor.castAttributes(attributes, "set")),
        );
        row[key] = newId;
        applyIncrementingKeyType(
          ctor,
          row,
          !classHasNoCasts(ctor as unknown as ModelClass),
        );
      } else {
        if (row[key] != null && attributes[key] == null) {
          attributes[key] = row[key];
        }
        await withoutQueryWriteHook(() =>
          table.insert(ctor.castAttributes(attributes, "set")),
        );
      }
      this.#exists = true;
      this.#wasRecentlyCreated = true;
      await fireModelEvent(this, "created");
    } else {
      if ((await fireModelEvent(this, "updating")) === false) return this;
      const attributes = persistableAttributes(persistCtor, dirty, key);
      if (Object.keys(attributes).length > 0) {
        await withoutQueryWriteHook(() =>
          table.where(key, id).update(ctor.castAttributes(attributes, "set")),
        );
      }
      this.#wasRecentlyCreated = false;
      await fireModelEvent(this, "updated");
    }

    this.#changes = { ...dirty };
    if (usesTimestamps) {
      if ("updated_at" in row) this.#changes.updated_at = row.updated_at;
      if (!exists && "created_at" in row) {
        this.#changes.created_at = row.created_at;
      }
    }
    this.#capturePrevious(!exists);
    this.syncOriginal();
    await fireModelEvent(this, "saved");
    // finishSave → touchOwners (Relation.touch honors withoutTouching on related).
    await this.touchOwners();
    return this;
  }

  /** `$model->saveQuietly()`. */
  async saveQuietly(): Promise<this> {
    const ctor = this.constructor as typeof Model;
    return ctor.withoutEvents(() => this.save());
  }

  /** `$model->refresh()`. */
  async refresh(): Promise<this> {
    const ctor = this.constructor as ModelClass;
    const key = ctor.primaryKey;
    const id = (this as unknown as Record<string, unknown>)[key];
    const fresh = await ctor.find(id as string | number);
    if (fresh) {
      Object.assign(this, fresh.getAttributes());
      this.#original = { ...fresh.#original };
      this.#exists = true;
    }
    return this;
  }

  /**
   * Refresh under row lock (`lockForUpdate`).
   * Reloads this instance from a locked select of the same primary key.
   */
  async refreshForUpdate(): Promise<this> {
    const ctor = this.constructor as ModelClass;
    const key = ctor.primaryKey;
    const id = (this as unknown as Record<string, unknown>)[key];
    const fresh = await ctor
      .newQuery()
      .lockForUpdate()
      .find(id as string | number);
    if (fresh) {
      Object.assign(this, fresh.getAttributes());
      this.#original = { ...fresh.#original };
      this.#exists = true;
    }
    return this;
  }

  /** `$model->fresh()`. */
  async fresh(): Promise<this | null> {
    const ctor = this.constructor as ModelClass;
    const key = ctor.primaryKey;
    const id = (this as unknown as Record<string, unknown>)[key];
    return (await ctor.find(id as string | number)) as this | null;
  }

  /** Eager-load relations onto this model (`load('posts')` / constrained maps). */
  async load(
    ...relations: Array<string | Record<string, unknown>>
  ): Promise<this> {
    await eagerLoadModels([this], normalizeWithRelations(relations));
    return this;
  }

  /** Load only relations that are not already present. */
  async loadMissing(
    ...relations: Array<string | Record<string, unknown>>
  ): Promise<this> {
    const normalized = normalizeWithRelations(relations);
    const missing = normalized.filter((entry) => !this.relationLoaded(entry.name));
    if (missing.length > 0) await eagerLoadModels([this], missing);
    return this;
  }

  /** `$model->relationLoaded($key)`. */
  relationLoaded(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this, key);
  }

  /**
   * Sync-save path: touch `$touches` via BelongsTo.touchSync when available.
   */
  #touchOwnersSync(): void {
    const ctor = this.constructor as typeof Model;
    const names = ctor.touches ?? [];
    if (names.length === 0) return;
    for (const name of names) {
      const rel = this.related(name) as {
        touchSync?: () => boolean;
        touch?: () => boolean | Promise<boolean>;
      };
      if (typeof rel.touchSync === "function") {
        rel.touchSync();
        continue;
      }
      if (typeof rel.touch === "function") {
        void rel.touch();
      }
    }
  }

  /**
   * `$model->touches($relation)` — whether `$touches` lists this relation.
   */
  touches(relation: string): boolean {
    const ctor = this.constructor as typeof Model;
    return (ctor.touches ?? []).includes(relation);
  }

  /**
   * `$model->touchOwners()` — touch each relation in `$touches`.
   * Uses `relation.touch()` when available (BelongsTo / HasOne / HasMany);
   * otherwise loads the related model and calls `touch()` on it.
   */
  async touchOwners(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    const names = ctor.touches ?? [];
    if (names.length === 0) return;
    for (const name of names) {
      const rel = this.related(name) as {
        touch?: () => boolean | Promise<boolean>;
        first?: () => Promise<Model | null>;
      };
      if (typeof rel.touch === "function") {
        await rel.touch();
        continue;
      }
      if (typeof rel.first === "function") {
        const related = await rel.first();
        if (related) await related.touch();
      }
    }
  }

  /**
   * `$model->touch()` — bump `updated_at` (no-op while `withoutTouching`).
   * Saving also runs `$touches` / `touchOwners()` for listed relations.
   */
  async touch(): Promise<boolean> {
    const ctor = this.constructor as typeof Model;
    if (isIgnoringTouch(ctor)) return false;
    if (ctor.timestamps === false) return false;
    if (!this.#exists) return false;
    const conn = this.getConnection();
    const now = nowForConnection(conn);
    (this as unknown as Record<string, unknown>).updated_at = now;
    await this.save();
    return true;
  }

  /**
   * Relation query builder (`$model->product()`).
   *
   * Define relations on `static relations` and declare the loaded property:
   * `declare product: Product | null` — then use `model.product` after `with('product')`,
   * and `model.related('product')` when you need the relation query.
   *
   * Legacy instance methods named `product()` remain supported via the prototype.
   */
  related(name: string): unknown {
    const ctor = this.constructor as ModelClass;
    if (
      modelsShouldPreventLazyLoading() &&
      !isInsideEagerLoad() &&
      this.#exists &&
      !this.relationLoaded(name)
    ) {
      throw new LazyLoadingViolationException(
        (ctor as { name?: string }).name ?? "Model",
        name,
      );
    }
    const raw = ctor.relations;
    const map = typeof raw === "function" ? raw.call(ctor) : raw;
    if (map != null && typeof map[name] === "function") {
      return map[name]!(this);
    }
    let proto: object | null = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      if (desc && typeof desc.value === "function") {
        return (desc.value as (this: Model) => unknown).call(this);
      }
      proto = Object.getPrototypeOf(proto);
    }
    throw new Error(
      `Call to undefined relationship [${name}] on model [${(ctor as { name?: string }).name ?? "Model"}].`,
    );
  }

  /** `$model->replicate()`. */
  replicate(except: string[] = []): this {
    const ctor = this.constructor as typeof Model;
    ctor.bootIfNotBooted();
    const key = ctor.primaryKey;
    const skip = new Set([key, "created_at", "updated_at", ...except]);
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      this as unknown as Record<string, unknown>,
    )) {
      if (skip.has(k) || typeof v === "function") continue;
      attrs[k] = v;
    }
    const copy = new ctor(attrs) as this;
    // Fire sync-style; listeners may be async but replicate is sync.
    void fireModelEvent(copy, "replicating");
    return copy;
  }

  async delete(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    ctor.bootIfNotBooted();
    if ((await fireModelEvent(this, "deleting")) === false) return;

    if (usesSoftDeletes(ctor as ModelClass)) {
      await this.#performSoftDelete();
      await fireModelEvent(this, "deleted");
      await fireModelEvent(this, "trashed");
      return;
    }

    // delete(): touchOwners before performDeleteOnModel.
    await this.touchOwners();
    await this.#performForceDelete();
    await fireModelEvent(this, "deleted");
  }

  async restore(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    if (!usesSoftDeletes(ctor as ModelClass)) return;
    ctor.bootIfNotBooted();
    if ((await fireModelEvent(this, "restoring")) === false) return;

    const key = ctor.primaryKey;
    const row = this as unknown as Record<string, unknown>;
    const col = deletedAtColumn(ctor as ModelClass);
    row[col] = null;
    await new Db(this.getConnection())
      .table(ctor.table)
      .where(key, row[key])
      .update({ [col]: null });
    await fireModelEvent(this, "restored");
  }

  async forceDelete(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    ctor.bootIfNotBooted();
    if ((await fireModelEvent(this, "forceDeleting")) === false) return;
    await this.#performForceDelete();
    await fireModelEvent(this, "forceDeleted");
    await fireModelEvent(this, "deleted");
  }

  /** `$model->deleteQuietly()`. */
  async deleteQuietly(): Promise<void> {
    const ctor = this.constructor as typeof Model;
    await ctor.withoutEvents(() => this.delete());
  }

  async #performSoftDelete(): Promise<void> {
    const ctor = this.constructor as ModelClass;
    const key = ctor.primaryKey;
    const row = this as unknown as Record<string, unknown>;
    const col = deletedAtColumn(ctor);
    const now = nowForConnection(this.getConnection());
    row[col] = now;
    const payload: Record<string, unknown> = { [col]: now };
    if (ctor.timestamps !== false) {
      row.updated_at = now;
      payload.updated_at = now;
    }
    await withoutQueryWriteHook(() =>
      new Db(this.getConnection())
        .table(ctor.table)
        .where(key, row[key])
        .update(payload),
    );
    await this.touchOwners();
  }

  async #performForceDelete(): Promise<void> {
    const ctor = this.constructor as ModelClass;
    const key = ctor.primaryKey;
    const row = this as unknown as Record<string, unknown>;
    await withoutQueryWriteHook(() =>
      new Db(this.getConnection())
        .table(ctor.table)
        .where(key, row[key])
        .delete(),
    );
    this.#exists = false;
  }

  trashed(): boolean {
    const ctor = this.constructor as ModelClass;
    if (!usesSoftDeletes(ctor)) return false;
    const col = deletedAtColumn(ctor);
    const value = (this as unknown as Record<string, unknown>)[col];
    return value != null && value !== "";
  }

  /** `$model->toArray()`. */
  toArray(): Record<string, unknown> {
    const ctor = this.constructor as ModelClass;
    const hiddenList = this.getHidden();
    const visibleList = this.getVisible();
    const appends = this.getAppends();
    const self = this as unknown as Record<string, unknown>;
    const hidden = new Set(hiddenList);
    const visible =
      visibleList.length > 0 ? new Set(visibleList) : null;
    const out: Record<string, unknown> = {};
    for (const key in self) {
      const value = self[key];
      if (typeof value === "function") continue;
      if (hidden.has(key)) continue;
      if (visible && !visible.has(key)) continue;
      out[key] = value instanceof Date ? value.toISOString() : value;
    }
    for (const key of appends) {
      if (hidden.has(key)) continue;
      if (visible && !visible.has(key)) continue;
      out[key] = this.#mutateAppendedAttribute(key);
    }
    return out;
  }

  #mutateAppendedAttribute(key: string): unknown {
    const studly = key
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    const getter = `get${studly}Attribute`;
    const fn = (this as unknown as Record<string, unknown>)[getter];
    if (typeof fn === "function") {
      return (fn as () => unknown).call(this);
    }
    return (this as unknown as Record<string, unknown>)[key];
  }

  /** `$model->loadCount(...$relations)`. */
  async loadCount(...relations: string[]): Promise<this> {
    const names = relations.flat();
    if (names.length === 0) return this;
    for (const relation of names) {
      const parsed = parseRelationAlias(relation);
      const count = await aggregateRelation(this, parsed.relation, "count");
      (this as unknown as Record<string, unknown>)[
        parsed.alias ?? `${parsed.relation}_count`
      ] = count;
    }
    return this;
  }

  /** `$model->loadSum($relation, $column)`. */
  async loadSum(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    const value = await aggregateRelation(this, parsed.relation, "sum", column);
    (this as unknown as Record<string, unknown>)[
      parsed.alias ?? `${parsed.relation}_sum_${column}`
    ] = value;
    return this;
  }

  async loadAvg(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    const value = await aggregateRelation(this, parsed.relation, "avg", column);
    (this as unknown as Record<string, unknown>)[
      parsed.alias ?? `${parsed.relation}_avg_${column}`
    ] = value;
    return this;
  }

  async loadMin(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    const value = await aggregateRelation(this, parsed.relation, "min", column);
    (this as unknown as Record<string, unknown>)[
      parsed.alias ?? `${parsed.relation}_min_${column}`
    ] = value;
    return this;
  }

  async loadMax(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    const value = await aggregateRelation(this, parsed.relation, "max", column);
    (this as unknown as Record<string, unknown>)[
      parsed.alias ?? `${parsed.relation}_max_${column}`
    ] = value;
    return this;
  }

  /** `$model->loadExists(...$relations)`. */
  async loadExists(...relations: string[]): Promise<this> {
    for (const relation of relations.flat()) {
      const parsed = parseRelationAlias(relation);
      const value = await aggregateRelation(this, parsed.relation, "exists");
      (this as unknown as Record<string, unknown>)[
        parsed.alias ?? `${parsed.relation}_exists`
      ] = value;
    }
    return this;
  }

  toJSON(): Record<string, unknown> {
    return this.toArray();
  }

  /** Alias of {@link toJSON}. */
  toJson(): Record<string, unknown> {
    return this.toJSON();
  }

  /** `$model->increment($column, $amount)`. */
  async increment(column: string, amount = 1): Promise<this> {
    const row = this as unknown as Record<string, unknown>;
    const current = Number(row[column] ?? 0);
    row[column] = current + amount;
    await this.save();
    return this;
  }

  /** `$model->decrement($column, $amount)`. */
  async decrement(column: string, amount = 1): Promise<this> {
    return this.increment(column, -amount);
  }

  /** `Model::destroy($ids)`. */
  static async destroy<T extends typeof Model>(
    this: T,
    ids: Array<string | number> | string | number,
  ): Promise<number> {
    const list = Array.isArray(ids) ? ids : [ids];
    let n = 0;
    for (const id of list) {
      const model = await this.find(id);
      if (!model) continue;
      await model.delete();
      n += 1;
    }
    return n;
  }

  /**
   * `Model::forceDestroy($ids)` — permanent delete by key(s).
   * Soft-delete models are found via `withTrashed()` so trashed rows are included.
   */
  static async forceDestroy<T extends typeof Model>(
    this: T,
    ids: Array<string | number> | string | number,
  ): Promise<number> {
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length === 0) return 0;
    this.bootIfNotBooted();
    const key = this.primaryKey;
    const models = await this.newQuery().withTrashed().whereIn(key, list).get();
    let n = 0;
    for (const model of models) {
      await model.forceDelete();
      n += 1;
    }
    return n;
  }

  /** `$this->hasMany(Related::class)`. */
  hasMany<R extends ModelClass>(
    related: R,
    foreignKey?: string,
    localKey?: string,
  ): HasMany<InstanceType<R>> {
    const key =
      foreignKey ?? `${singular((this.constructor as ModelClass).table)}_id`;
    return new HasMany(this, related, key, localKey);
  }

  /** `$this->hasOne(Related::class)`. */
  hasOne<R extends ModelClass>(
    related: R,
    foreignKey?: string,
    localKey?: string,
  ): HasOne<InstanceType<R>> {
    const key =
      foreignKey ?? `${singular((this.constructor as ModelClass).table)}_id`;
    return new HasOne(this, related, key, localKey);
  }

  /**
   * `$this->hasManyThrough(Related::class, Through::class)`.
   * Parent → Through (firstKey) → Related (secondKey).
   */
  hasManyThrough<R extends ModelClass, TThrough extends ModelClass>(
    related: R,
    through: TThrough,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string,
  ): HasManyThrough<InstanceType<R>> {
    const parentCtor = this.constructor as ModelClass;
    return new HasManyThrough(
      this,
      related,
      through,
      firstKey ?? `${singular(parentCtor.table)}_id`,
      secondKey ?? `${singular(through.table)}_id`,
      localKey ?? parentCtor.primaryKey,
      secondLocalKey ?? through.primaryKey,
    );
  }

  /**
   * `$this->hasOneThrough(Related::class, Through::class)`.
   */
  hasOneThrough<R extends ModelClass, TThrough extends ModelClass>(
    related: R,
    through: TThrough,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string,
  ): HasOneThrough<InstanceType<R>> {
    const parentCtor = this.constructor as ModelClass;
    return new HasOneThrough(
      this,
      related,
      through,
      firstKey ?? `${singular(parentCtor.table)}_id`,
      secondKey ?? `${singular(through.table)}_id`,
      localKey ?? parentCtor.primaryKey,
      secondLocalKey ?? through.primaryKey,
    );
  }

  /** `$this->belongsTo(Related::class)`. */
  belongsTo<R extends ModelClass>(
    related: R,
    foreignKey?: string,
    ownerKey?: string,
  ): BelongsTo<InstanceType<R>> {
    const key = foreignKey ?? `${singular(related.table)}_id`;
    return new BelongsTo(this, related, key, ownerKey);
  }

  /** `$this->belongsToMany(Related::class, pivot)`. */
  belongsToMany<R extends ModelClass>(
    related: R,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
  ): BelongsToMany<InstanceType<R>> {
    const parent = this.constructor as ModelClass;
    const pivot =
      table ??
      [singular(parent.table), singular(related.table)].sort().join("_");
    const foreign =
      foreignPivotKey ?? `${singular(parent.table)}_id`;
    const relatedKey =
      relatedPivotKey ?? `${singular(related.table)}_id`;
    return new BelongsToMany(this, related, pivot, foreign, relatedKey);
  }

  /**
   * Polymorphic many-to-many (`model_has_roles`-style pivots).
   * Third argument may be the pivot table name or an options bag (tenant/legacy morph types).
   */
  morphToMany<R extends ModelClass>(
    related: R,
    name: string,
    tableOrOptions?: string | MorphToManyOptions,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
  ): MorphToMany<InstanceType<R>> {
    const options: MorphToManyOptions =
      typeof tableOrOptions === "string" || tableOrOptions == null
        ? {
            table: tableOrOptions,
            foreignPivotKey,
            relatedPivotKey,
          }
        : tableOrOptions;
    const table = options.table ?? "model_has_roles";
    const foreign = options.foreignPivotKey ?? "model_id";
    const relatedKey =
      options.relatedPivotKey ?? `${singular(related.table)}_id`;
    const morphTypeColumn = options.morphTypeColumn ?? "model_type";
    const primaryMorph = morphTypeFor(this.constructor as ModelClass);
    const morphTypes =
      options.morphTypes && options.morphTypes.length > 0
        ? options.morphTypes
        : [name, primaryMorph].filter(
            (value, index, all) => all.indexOf(value) === index,
          );
    return new MorphToMany(
      this,
      related,
      table,
      foreign,
      relatedKey,
      morphTypeColumn,
      morphTypes,
      options.pivotTenantKey,
      options.parentTenantKey ?? options.pivotTenantKey,
    );
  }

  /** `$this->morphMany(Related::class, name)`. */
  morphMany<R extends ModelClass>(
    related: R,
    name: string,
    type?: string,
    id?: string,
    localKey?: string,
  ): MorphMany<InstanceType<R>> {
    return new MorphMany(
      this,
      related,
      type ?? `${name}_type`,
      id ?? `${name}_id`,
      morphTypeFor(this.constructor as ModelClass),
      localKey,
    );
  }

  /** `$this->morphOne(Related::class, name)`. */
  morphOne<R extends ModelClass>(
    related: R,
    name: string,
    type?: string,
    id?: string,
    localKey?: string,
  ): MorphOne<InstanceType<R>> {
    return new MorphOne(
      this,
      related,
      type ?? `${name}_type`,
      id ?? `${name}_id`,
      morphTypeFor(this.constructor as ModelClass),
      localKey,
    );
  }

  /** `$this->morphTo($name)`. */
  morphTo(
    name: string,
    type?: string,
    id?: string,
    ownerKey?: string,
  ): MorphTo {
    return new MorphTo(
      this,
      type ?? `${name}_type`,
      id ?? `${name}_id`,
      ownerKey,
    );
  }
}

installLocalScopeCallStatic(Model);

/** True when `value` is a Model subclass constructor (O(1) prototype check). */
export function isModelCtor(value: unknown): value is ModelClass {
  return (
    typeof value === "function" &&
    value !== Model &&
    Boolean((value as { prototype?: unknown }).prototype) &&
    (value as { prototype: object }).prototype instanceof Model
  );
}

// Re-exports — public API stays on ./model.ts for index.ts
export {
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
  clearMorphMap,
  morphMap,
  type MorphToManyOptions,
} from "./relations.ts";
export {
  eagerLoadAggregates,
  eagerLoadModels,
  type EagerAggregateSpec,
} from "./eager.ts";
export { ModelQuery } from "./model-query.ts";
export {
  LazyLoadingViolationException,
  MassAssignmentException,
  MissingAttributeException,
  resetModelStrictnessForTests,
} from "./model-strictness.ts";
