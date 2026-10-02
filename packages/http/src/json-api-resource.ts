import { json } from "./response.ts";
import {
  collectResourceItems,
  JsonResource,
  normalizeResourceResponseArgs,
  ResourceCollection,
  type ResourceCollectable,
} from "./resource.ts";

/** Minimal request duck-type for include / fields query parsing. */
export type JsonApiRequestLike = {
  url?: string;
  query?: (key: string, defaultValue?: string | null) => string | null | undefined;
  input?: (key: string, defaultValue?: unknown) => unknown;
};

export type JsonApiResourceObject = {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    { data: { type: string; id: string } | Array<{ type: string; id: string }> | null }
  >;
};

export type JsonApiDocument = {
  data: JsonApiResourceObject | JsonApiResourceObject[] | null;
  included?: JsonApiResourceObject[];
  meta?: Record<string, unknown>;
  links?: Record<string, unknown>;
};

type RelationshipFactory =
  | JsonApiResource<unknown>
  | JsonApiResource<unknown>[]
  | ResourceCollection<unknown>
  | (() =>
      | JsonApiResource<unknown>
      | JsonApiResource<unknown>[]
      | ResourceCollection<unknown>
      | null
      | undefined);

const JSON_API = "application/vnd.api+json";

/**
 * `JsonApiResource` — minimal JSON:API document builder.
 *
 * Override `toAttributes` / `toRelationships`. Supports `?include=` and
 * `?fields[type]=a,b` when a request is passed via `withRequest` / `toResponse`.
 */
export abstract class JsonApiResource<T = unknown> extends JsonResource<T> {
  #request: JsonApiRequestLike | null = null;
  #included = new Map<string, JsonApiResourceObject>();

  /** JSON:API `type` (default: kebab of class name without `Resource`). */
  type(): string {
    const ctor = this.constructor as { type?: string; name: string };
    if (ctor.type) return ctor.type;
    const name = ctor.name.replace(/Resource$/, "");
    return toKebab(name || "resource");
  }

  /** JSON:API `id` (string). */
  id(): string {
    const r = this.resource as { id?: unknown; getKey?: () => unknown };
    const raw =
      typeof r.getKey === "function" ? r.getKey() : (r as { id?: unknown }).id;
    if (raw == null) {
      throw new Error(`JsonApiResource [${this.type()}] is missing an id.`);
    }
    return String(raw);
  }

  /**
   * Resource attributes (JSON:API `attributes` object).
   * Default: empty — subclasses should override.
   */
  toAttributes(_request?: JsonApiRequestLike | null): Record<string, unknown> {
    return {};
  }

  /**
   * Relationship map — values are resources or lazy factories.
   * Only serialized when listed in `?include=`.
   */
  toRelationships(
    _request?: JsonApiRequestLike | null,
  ): Record<string, RelationshipFactory> {
    return {};
  }

  /** Bind the incoming request for include / sparse fieldsets. */
  withRequest(request: JsonApiRequestLike | null): this {
    this.#request = request;
    return this;
  }

  /** Classic JsonResource shape — attributes only (not a full JSON:API doc). */
  toArray(): Record<string, unknown> {
    return this.toAttributes(this.#request);
  }

  /** Build a single resource object (`type` / `id` / `attributes` / `relationships`). */
  toResourceObject(
    request: JsonApiRequestLike | null = this.#request,
    includes: Set<string> = parseIncludes(request),
  ): JsonApiResourceObject {
    const type = this.type();
    const fields = sparseFieldsFor(request, type);
    let attributes = this.toAttributes(request);
    if (fields) {
      const next: Record<string, unknown> = {};
      for (const key of fields) {
        if (key in attributes) next[key] = attributes[key];
      }
      attributes = next;
    }

    const object: JsonApiResourceObject = {
      type,
      id: this.id(),
    };
    if (Object.keys(attributes).length > 0) {
      object.attributes = attributes;
    }

    const relationships = this.toRelationships(request);
    const relOut: NonNullable<JsonApiResourceObject["relationships"]> = {};
    for (const [name, factory] of Object.entries(relationships)) {
      if (!includes.has(name)) continue;
      // Sparse fieldsets: relationship name must be requested on parent type when fields set
      if (fields && !fields.has(name) && fields.size > 0) {
        // still allow if include asked;
        // keep include-driven for MVP unless fields explicitly omits and is non-empty without rel
      }
      const resolved = typeof factory === "function" ? factory() : factory;
      const resources = normalizeRelated(resolved);
      if (resources.length === 0) {
        relOut[name] = { data: null };
        continue;
      }
      if (resources.length === 1) {
        const one = resources[0]!;
        one.withRequest(request);
        const obj = one.toResourceObject(request, new Set());
        this.#rememberIncluded(obj);
        // Nested include author.comments → not in MVP; top-level only
        relOut[name] = { data: { type: obj.type, id: obj.id } };
      } else {
        const data = resources.map((rel) => {
          rel.withRequest(request);
          const obj = rel.toResourceObject(request, new Set());
          this.#rememberIncluded(obj);
          return { type: obj.type, id: obj.id };
        });
        relOut[name] = { data };
      }
    }
    if (Object.keys(relOut).length > 0) {
      object.relationships = relOut;
    }
    return object;
  }

  /** Full JSON:API document. */
  toDocument(
    request: JsonApiRequestLike | null = this.#request,
  ): JsonApiDocument {
    this.#included.clear();
    const includes = parseIncludes(request);
    const data = this.toResourceObject(request, includes);
    const doc: JsonApiDocument = { data };
    if (this.#included.size > 0) {
      doc.included = [...this.#included.values()].filter(
        (row) => !(row.type === data.type && row.id === data.id),
      );
      if (doc.included.length === 0) delete doc.included;
    }
    return doc;
  }

  override toResponse(requestOrStatus?: unknown, status = 200): Response {
    const args = normalizeResourceResponseArgs(requestOrStatus, status);
    if (args.request && typeof args.request === "object") {
      this.withRequest(args.request as JsonApiRequestLike);
    }
    const body = this.toDocument(this.#request);
    const res = json(body, args.status);
    res.headers.set("Content-Type", JSON_API);
    return res;
  }

  override response(status = 200): Response {
    return this.toResponse(undefined, status);
  }

  #rememberIncluded(object: JsonApiResourceObject): void {
    this.#included.set(`${object.type}:${object.id}`, object);
  }

  protected static override createCollection(
    resources: ResourceCollectable<never>,
    status: number,
  ): ResourceCollection<never> {
    return new JsonApiResourceCollection(
      resources,
      this as unknown as new (resource: never) => JsonApiResource,
      status,
    ) as ResourceCollection<never>;
  }
}

/** JSON:API collection document. */
export class JsonApiResourceCollection<T> extends ResourceCollection<T> {
  #request: JsonApiRequestLike | null = null;
  #makeItem: (item: T) => JsonApiResource;

  constructor(
    resource: ResourceCollectable<T>,
    collects: new (resource: T) => JsonApiResource,
    status = 200,
  ) {
    super(resource, collects as new (resource: T) => JsonResource, status);
    this.#makeItem = (item) => new collects(item);
  }

  withRequest(request: JsonApiRequestLike | null): this {
    this.#request = request;
    return this;
  }

  /** Expose related resources for relationship normalization. */
  itemsAsResources(): JsonApiResource[] {
    return collectResourceItems<T>(this.resource).map((item) =>
      this.#makeItem(item),
    );
  }

  toDocument(): JsonApiDocument {
    const included = new Map<string, JsonApiResourceObject>();
    const data = collectResourceItems<T>(this.resource).map((item) => {
      const res = this.#makeItem(item).withRequest(this.#request);
      const doc = res.toDocument(this.#request);
      for (const row of doc.included ?? []) {
        included.set(`${row.type}:${row.id}`, row);
      }
      return doc.data as JsonApiResourceObject;
    });
    const doc: JsonApiDocument = { data };
    if (included.size > 0) doc.included = [...included.values()];
    return doc;
  }

  override toResponse(requestOrStatus?: unknown, status = this.status): Response {
    const args = normalizeResourceResponseArgs(requestOrStatus, status);
    if (args.request && typeof args.request === "object") {
      this.withRequest(args.request as JsonApiRequestLike);
    }
    const res = json(this.toDocument(), args.status);
    res.headers.set("Content-Type", JSON_API);
    return res;
  }
}

function normalizeRelated(
  resolved:
    | JsonApiResource<unknown>
    | JsonApiResource<unknown>[]
    | JsonApiResourceCollection<unknown>
    | ResourceCollection<unknown>
    | null
    | undefined,
): JsonApiResource<unknown>[] {
  if (resolved == null) return [];
  if (Array.isArray(resolved)) return resolved;
  if (resolved instanceof JsonApiResourceCollection) {
    return resolved.itemsAsResources();
  }
  if (resolved instanceof ResourceCollection) {
    return [];
  }
  return [resolved];
}

function parseIncludes(request: JsonApiRequestLike | null): Set<string> {
  if (!request) return new Set();
  const raw =
    request.query?.("include") ??
    (typeof request.input === "function"
      ? request.input("include")
      : undefined) ??
    queryFromUrl(request.url, "include");
  if (raw == null || raw === "") return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(".")[0]!),
  );
}

function sparseFieldsFor(
  request: JsonApiRequestLike | null,
  type: string,
): Set<string> | null {
  if (!request) return null;
  // fields[posts]=title,body
  const fromInput =
    typeof request.input === "function"
      ? request.input(`fields[${type}]`) ??
        (request.input("fields") as Record<string, string> | undefined)?.[type]
      : undefined;
  const fromQuery =
    request.query?.(`fields[${type}]`) ??
    queryFromUrl(request.url, `fields[${type}]`);
  const raw = fromInput ?? fromQuery;
  if (raw == null) return null;
  if (raw === "") return new Set();
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function queryFromUrl(url: string | undefined, key: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, "http://localhost");
    return u.searchParams.get(key);
  } catch {
    return null;
  }
}

function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
