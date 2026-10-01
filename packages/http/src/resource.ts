import { json } from "./response.ts";

/** Duck-typed paginator (satisfied by `@bunyad/database` length-aware / simple / cursor paginators). */
export type ResourcePaginator<T> = {
  items: T[];
  perPage?: number;
  pageItems?: () => T[];
  toJSON(data?: readonly Record<string, unknown>[]): Record<string, unknown>;
};

type CollectionLike<T> = {
  all(): T[];
};

/** Array, paginator, or collection passed to `JsonResource.collection()`. */
export type ResourceCollectable<T> =
  | T[]
  | ResourcePaginator<T>
  | CollectionLike<T>;

export type ResolvedResource =
  | Record<string, unknown>
  | Record<string, unknown>[];

/** Sentinel omitted from JSON when a `when()` condition fails. */
export class MissingValue {
  readonly __missing = true;
}

const missing = new MissingValue();

function isMissing(value: unknown): value is MissingValue {
  return value instanceof MissingValue;
}

/** Drop MissingValue keys from a resolved resource array or object. */
export function filterMissing(value: unknown): unknown {
  if (isMissing(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !isMissing(entry))
      .map((entry) => filterMissing(entry));
  }
  if (
    !value ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isMissing(entry)) continue;
    out[key] = filterMissing(entry);
  }
  return out;
}

function containsMissing(value: unknown): boolean {
  if (isMissing(value)) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => containsMissing(entry));
  }
  if (
    !value ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return false;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (containsMissing(entry)) return true;
  }
  return false;
}

type ModelLike = {
  relationLoaded?: (name: string) => boolean;
  relation?: (name: string) => unknown;
  getAttribute?: (key: string) => unknown;
  [key: string]: unknown;
};

export function isResourcePaginator<T>(
  value: unknown,
): value is ResourcePaginator<T> {
  if (value == null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  // Support collections expose `all()`; paginators do not.
  if (typeof row.all === "function") return false;
  return Array.isArray(row.items) && typeof row.toJSON === "function";
}

function isCollectionLike<T>(value: unknown): value is CollectionLike<T> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as CollectionLike<T>).all === "function"
  );
}

/** Unwrap an array, paginator, or `{ all() }` collection to rows. */
export function collectResourceItems<T>(resource: unknown): T[] {
  if (isMissing(resource) || resource == null) return [];
  if (Array.isArray(resource)) return resource as T[];
  if (isResourcePaginator<T>(resource)) {
    return typeof resource.pageItems === "function"
      ? resource.pageItems()
      : resource.items;
  }
  if (isCollectionLike<T>(resource)) return resource.all();
  if (
    typeof resource === "object" &&
    Array.isArray((resource as { items?: unknown }).items)
  ) {
    return (resource as { items: T[] }).items;
  }
  return [];
}

function mergeResponseData(
  ...parts: Record<string, unknown>[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      const existing = out[key];
      if (
        existing &&
        value &&
        typeof existing === "object" &&
        typeof value === "object" &&
        !Array.isArray(existing) &&
        !Array.isArray(value) &&
        !(existing instanceof Date) &&
        !(value instanceof Date)
      ) {
        out[key] = {
          ...(existing as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

export function normalizeResourceResponseArgs(
  requestOrStatus?: unknown,
  status = 200,
): { request: unknown; status: number } {
  if (typeof requestOrStatus === "number") {
    return { request: undefined, status: requestOrStatus };
  }
  return { request: requestOrStatus, status };
}

/**
 * API resource — transform a model/array into JSON.
 *
 * ```ts
 * class UserResource extends JsonResource<User> {
 *   toArray() {
 *     return {
 *       id: this.resource.id,
 *       email: this.when(Boolean(this.resource.email), this.resource.email),
 *       ...this.mergeWhen(this.resource.admin, { role: "admin" }),
 *     };
 *   }
 * }
 *
 * return UserResource.make(user);
 * return UserResource.collection(users);
 * return UserResource.collection(User.paginate());
 * ```
 */
export abstract class JsonResource<T = unknown> {
  static wrapKey: string | null = "data";

  #with: Record<string, unknown> = {};
  #additional: Record<string, unknown> = {};
  #wrap: string | null | undefined;
  #withResponse?: (response: Response) => void;

  constructor(public resource: T) {}

  abstract toArray(_request?: unknown): ResolvedResource;

  /** Conditionally include a value; omitted from JSON when false. */
  when<V>(
    condition: boolean,
    value: V | (() => V),
    defaultValue: V | MissingValue = missing,
  ): V | MissingValue {
    if (condition) {
      return typeof value === "function" ? (value as () => V)() : value;
    }
    return defaultValue;
  }

  /** Inverse of `when`. */
  unless<V>(
    condition: boolean,
    value: V | (() => V),
    defaultValue: V | MissingValue = missing,
  ): V | MissingValue {
    return this.when(!condition, value, defaultValue);
  }

  /** Include when value is not null. */
  whenNotNull<V>(
    value: V | null | undefined,
    defaultValue: V | MissingValue = missing,
  ): V | MissingValue {
    return value == null ? defaultValue : value;
  }

  /** Include when value is null. */
  whenNull<V>(
    value: unknown,
    callback: () => V,
    defaultValue: V | MissingValue = missing,
  ): V | MissingValue {
    return value == null ? callback() : defaultValue;
  }

  /** Include a loaded relation (duck-typed). */
  whenLoaded<V>(
    relationship: string,
    value?: V | (() => V),
    defaultValue: V | MissingValue = missing,
  ): V | MissingValue {
    const model = this.resource as ModelLike;
    const loaded =
      typeof model.relationLoaded === "function"
        ? model.relationLoaded(relationship)
        : model[relationship] !== undefined;
    if (!loaded) return defaultValue;
    if (value !== undefined) {
      return typeof value === "function" ? (value as () => V)() : value;
    }
    return (typeof model.relation === "function"
      ? model.relation(relationship)
      : model[relationship]) as V;
  }

  whenCounted(
    relationship: string,
    value?: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    return this.whenAggregated(relationship, "count", value, defaultValue);
  }

  whenAggregated(
    relationship: string,
    column: string,
    value?: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    const key = `${relationship}_${column}`;
    const model = this.resource as ModelLike;
    const has =
      (typeof model.getAttribute === "function" &&
        model.getAttribute(key) !== undefined) ||
      model[key] !== undefined;
    if (!has) return defaultValue;
    if (value !== undefined) {
      return typeof value === "function" ? (value as () => unknown)() : value;
    }
    return typeof model.getAttribute === "function"
      ? model.getAttribute(key)
      : model[key];
  }

  whenAppended(
    attribute: string,
    value?: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    const model = this.resource as ModelLike;
    const has =
      (typeof model.getAttribute === "function" &&
        model.getAttribute(attribute) !== undefined) ||
      model[attribute] !== undefined;
    if (!has) return defaultValue;
    if (value !== undefined) {
      return typeof value === "function" ? (value as () => unknown)() : value;
    }
    return typeof model.getAttribute === "function"
      ? model.getAttribute(attribute)
      : model[attribute];
  }

  whenExistsLoaded(
    relationship: string,
    value?: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    return this.whenLoaded(relationship, value as never, defaultValue as never);
  }

  hasPivotLoaded(table: string): boolean {
    return this.hasPivotLoadedAs("pivot", table);
  }

  hasPivotLoadedAs(accessor: string, _table?: string): boolean {
    const model = this.resource as ModelLike;
    return model[accessor] != null;
  }

  whenPivotLoaded(
    table: string,
    value: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    return this.whenPivotLoadedAs("pivot", table, value, defaultValue);
  }

  whenPivotLoadedAs(
    accessor: string,
    _table: string,
    value: unknown | (() => unknown),
    defaultValue: unknown | MissingValue = missing,
  ): unknown | MissingValue {
    if (!this.hasPivotLoadedAs(accessor)) return defaultValue;
    return typeof value === "function" ? (value as () => unknown)() : value;
  }

  /** Merge attributes when condition is true. */
  mergeWhen(
    condition: boolean,
    attributes: Record<string, unknown> | (() => Record<string, unknown>),
  ): Record<string, unknown> {
    if (!condition) return {};
    return typeof attributes === "function" ? attributes() : attributes;
  }

  mergeUnless(
    condition: boolean,
    attributes: Record<string, unknown> | (() => Record<string, unknown>),
  ): Record<string, unknown> {
    return this.mergeWhen(!condition, attributes);
  }

  merge(attributes: Record<string, unknown>): Record<string, unknown> {
    return attributes;
  }

  /** Alias of `filterMissing` for resolved attributes. */
  filter(data?: unknown): unknown {
    return filterMissing(data ?? this.toArray());
  }

  removeMissingValues(data?: unknown): unknown {
    return this.filter(data);
  }

  /** Top-level extra keys (merged next to `data`). */
  with(data: Record<string, unknown>): this {
    this.#with = { ...this.#with, ...data };
    return this;
  }

  /** Extra keys merged into the response. */
  additional(data: Record<string, unknown>): this {
    this.#additional = { ...this.#additional, ...data };
    return this;
  }

  /** Change the wrap key for this instance. */
  wrap(key: string | null): this {
    this.#wrap = key;
    return this;
  }

  withoutWrapping(): this {
    this.#wrap = null;
    return this;
  }

  withResponse(callback: (response: Response) => void): this {
    this.#withResponse = callback;
    return this;
  }

  /** Global wrap key (`null` disables wrapping). */
  static wrap(key: string | null): void {
    this.wrapKey = key;
  }

  static withoutWrapping(): void {
    this.wrapKey = null;
  }

  protected wrapper(): string | null {
    return this.#wrap !== undefined
      ? this.#wrap
      : (this.constructor as typeof JsonResource).wrapKey;
  }

  protected extraWith(_request?: unknown): Record<string, unknown> {
    return this.#with;
  }

  protected extraAdditional(): Record<string, unknown> {
    return this.#additional;
  }

  /** Resolved attributes with MissingValue keys removed. */
  resolve(request?: unknown): ResolvedResource {
    const raw = this.toArray(request);
    return (
      containsMissing(raw) ? filterMissing(raw) : raw
    ) as ResolvedResource;
  }

  /** Alias of `resolve`. */
  transform(request?: unknown): ResolvedResource {
    return this.resolve(request);
  }

  /** Unwrapped attributes (used when nested inside another payload). */
  toJSON(): ResolvedResource {
    return this.resolve();
  }

  jsonSerialize(): ResolvedResource {
    return this.toJSON();
  }

  toJson(pretty = false): string {
    const body = this.toJSON();
    return pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body);
  }

  toPrettyJson(): string {
    return this.toJson(true);
  }

  /** `{ data: ... }` JSON response. */
  response(status = 200): Response {
    return this.toResponse(undefined, status);
  }

  toResponse(requestOrStatus?: unknown, status = 200): Response {
    const args = normalizeResourceResponseArgs(requestOrStatus, status);
    const res = json(this.payload(args.request), args.status);
    this.#withResponse?.(res);
    return res;
  }

  protected payload(request?: unknown): Record<string, unknown> {
    const resolved = this.resolve(request);
    const extra = mergeResponseData(
      this.extraWith(request),
      this.extraAdditional(),
    );
    const wrap = this.wrapper();
    if (wrap === null) {
      return mergeResponseData(
        typeof resolved === "object" &&
          resolved != null &&
          !Array.isArray(resolved)
          ? resolved
          : { data: resolved },
        extra,
      );
    }
    return { [wrap]: resolved, ...extra };
  }

  static make<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    resource: ConstructorParameters<TThis>[0],
  ): InstanceType<TThis> {
    return new this(resource as never) as InstanceType<TThis>;
  }

  /** Mapped `toArray()` values for a list of models. */
  static resolveCollection<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    resources: ResourceCollectable<ConstructorParameters<TThis>[0]>,
    request?: unknown,
  ): Record<string, unknown>[] {
    return collectResourceItems<ConstructorParameters<TThis>[0]>(resources).map(
      (item) => new this(item as never).resolve(request) as Record<string, unknown>,
    );
  }

  /**
   * Collection of this resource. Pass an array, `{ all() }` collection, or paginator.
   * Return from a controller — `toResponse(request)` wraps `{ data }` or paginated `data`/`links`/`meta`.
   */
  static collection<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    resources: MissingValue,
    status?: number,
  ): MissingValue;
  static collection<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    resources: ResourceCollectable<ConstructorParameters<TThis>[0]>,
    status?: number,
  ): ResourceCollection<ConstructorParameters<TThis>[0]>;
  static collection<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    resources:
      | ResourceCollectable<ConstructorParameters<TThis>[0]>
      | MissingValue,
    status = 200,
  ): ResourceCollection<ConstructorParameters<TThis>[0]> | MissingValue {
    if (resources instanceof MissingValue) return resources;
    const ctor = this as unknown as typeof JsonResource;
    return ctor.createCollection(
      resources as ResourceCollectable<never>,
      status,
    ) as ResourceCollection<ConstructorParameters<TThis>[0]>;
  }

  protected static createCollection(
    resources: ResourceCollectable<never>,
    status: number,
  ): ResourceCollection<never> {
    return new ResourceCollection(resources, this as never, status);
  }

  /** Paginated collection (`data` + `links` + `meta`). */
  static paginate<TThis extends new (resource: never) => JsonResource>(
    this: TThis,
    paginator: ResourcePaginator<ConstructorParameters<TThis>[0]>,
    status = 200,
  ): Response {
    return new ResourceCollection(
      paginator,
      this as unknown as new (
        resource: ConstructorParameters<TThis>[0],
      ) => JsonResource,
      status,
    ).toResponse(undefined, status);
  }
}

/** List of resources: `resolve()` for rows, `toResponse()` as `{ data: [...] }` (or paginated). */
export class ResourceCollection<T> extends JsonResource<ResourceCollectable<T>> {
  constructor(
    resource: ResourceCollectable<T>,
    private readonly collects: new (resource: T) => JsonResource,
    protected readonly status = 200,
  ) {
    super(resource);
  }

  override toArray(request?: unknown): Record<string, unknown>[] {
    return collectResourceItems<T>(this.resource).map(
      (item) =>
        new this.collects(item).resolve(request) as Record<string, unknown>,
    );
  }

  override resolve(request?: unknown): Record<string, unknown>[] {
    return this.toArray(request);
  }

  count(): number {
    return collectResourceItems(this.resource).length;
  }

  override toResponse(requestOrStatus?: unknown, status = this.status): Response {
    const args = normalizeResourceResponseArgs(requestOrStatus, status);
    if (isResourcePaginator(this.resource)) {
      const body = mergeResponseData(
        this.resource.toJSON(this.resolve(args.request)),
        this.extraWith(args.request),
        this.extraAdditional(),
      );
      return json(body, args.status);
    }
    return super.toResponse(args.request, args.status);
  }

  json(): Promise<unknown> {
    return this.toResponse().json();
  }
}
