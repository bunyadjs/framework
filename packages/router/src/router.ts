import { BunyadError } from "@bunyad/common";
import type { Responsable } from "@bunyad/contracts";
import { abort, HttpResponseException, redirect } from "@bunyad/http";
import type { Request } from "@bunyad/http";
import type { Middleware } from "@bunyad/http";
import { buildRadixTrees, matchRadix, type RadixNode } from "./radix.ts";
import {
  getUrlDefaults,
  normalizeRouteParams,
  type RouteParamValue,
} from "./context.ts";
import { formatPathWithParams } from "./query.ts";

/** Value a route closure or controller action may return. */
export type RouteActionResult =
  | Response
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | Readonly<Record<string, unknown>>
  /** Collection, Model, Paginator, … */
  | { toJSON(): unknown }
  /** Builds its own Response from the request (e.g. Inertia page responses). */
  | Responsable;

/**
 * Controller class for `[Controller, 'method']` actions.
 * May declare constructor deps — the HTTP kernel resolves them via `app.make()`.
 */
export type ControllerClass = new (...args: any[]) => object;

export type RouteAction =
  | ((
      // Closures may receive Request and/or bound models (inject plan).
      ...args: any[]
    ) => RouteActionResult | Promise<RouteActionResult>)
  | [ControllerClass, string]
  /** Invokable controller. Resolved to `[Controller, '__invoke']`. */
  | ControllerClass;

/** Stored route action. A controller class is resolved to `[Controller, '__invoke']`. */
export type ResolvedRouteAction = Exclude<RouteAction, ControllerClass>;

function isControllerClass(action: RouteAction): action is ControllerClass {
  return typeof action === "function" && /^class\s/.test(action.toString());
}

/**
 * A controller class is `[Controller, '__invoke']`.
 * A class without `__invoke` must be registered as `[Controller, 'method']`.
 */
export function resolveControllerAction(
  action: ControllerClass,
): [ControllerClass, string];
export function resolveControllerAction(action: RouteAction): ResolvedRouteAction;
export function resolveControllerAction(action: RouteAction): ResolvedRouteAction {
  if (!isControllerClass(action)) return action;
  const invoke = (action.prototype as Record<string, unknown>).__invoke;
  if (typeof invoke !== "function") {
    throw new BunyadError(
      `${action.name} is missing __invoke. Pass [Controller, 'method'] for a controller with more than one action.`,
      "BUNYAD_ROUTE_002",
    );
  }
  return [action, "__invoke"];
}

/** Precomputed action injection slot (boot/compile — never classified per request). */
export type InjectSlot =
  | { kind: "request" }
  | { kind: "form" }
  | { kind: "model"; param: string }
  /** Raw route segment (`{id}` → `"1"`), by parameter name. */
  | { kind: "param"; param: string };

/** Route middleware entry — alias string or middleware instance. */
export type RouteMiddleware = string | Middleware;

export type RouteDefinition = {
  methods: string[];
  uri: string;
  action: ResolvedRouteAction;
  name?: string;
  middleware: RouteMiddleware[];
  paramNames: string[];
  /** `{user:user_name}` → `{ user: "user_name" }`. */
  bindingFields: Record<string, string>;
  wheres: Record<string, string>;
  regex: RegExp;
  /** Host constraint when set via `domain()` / group domain. */
  domain?: string;
  /**
   * Scoped bindings:
   * `true` = `scopeBindings()`, `false` = `withoutScopedBindings()`,
   * `undefined` = scope only when a custom binding field is present.
   */
  scopeBindings?: boolean;
  /**
   * `withTrashed()` — allow soft-deleted models on implicit binding
   * (`allowsTrashedBindings`).
   */
  withTrashed?: boolean;
  /** Action arg plan stamped at boot/compile. */
  inject?: InjectSlot[];
  /** Called instead of the default 404 when a binder finds no model. */
  missing?: MissingBindingCallback;
  /** What a closure route from a helper does, so `bunyad compile` can register it again. */
  declaration?: RouteDeclaration;
};

/**
 * A route made by a helper (`Route.view(uri, name)`, `Route.redirect`,
 * `Inertia.route`, `Live.route`): a closure at runtime, described as data so a
 * compiled app registers it again. `handler` means the action is
 * `export(...args)` imported from `module`.
 */
export type RouteDeclaration =
  | { kind: "view"; view: string; data: Record<string, unknown>; status: number }
  | { kind: "redirect"; to: string; status: number }
  | { kind: "handler"; module: string; export: string; args: unknown[] };

export type RouteBinder = (
  value: string,
  request: Request,
) => unknown | Promise<unknown>;

/** Minimal model surface for `Route.model("post", Post)`. */
export type BindableModel = {
  find(id: string | number): unknown | null | Promise<unknown | null>;
  /** Custom column resolve (`{user:user_name}` / `getRouteKeyName`). */
  resolveRouteBinding?(
    value: string | number,
    field?: string,
  ): unknown | null | Promise<unknown | null>;
  /**
   * `resolveSoftDeletableRouteBinding` — include trashed
   * when the route opts in via `withTrashed()`.
   */
  resolveSoftDeletableRouteBinding?(
    value: string | number,
    field?: string,
  ): unknown | null | Promise<unknown | null>;
  /**
   * `resolveChildRouteBinding` — class-level fallback when the parent
   * instance has no instance method (tests / custom binders).
   */
  resolveChildRouteBinding?(
    childType: string,
    value: string | number,
    field?: string,
    parent?: unknown,
  ): unknown | null | Promise<unknown | null>;
  /** `resolveSoftDeletableChildRouteBinding`. */
  resolveSoftDeletableChildRouteBinding?(
    childType: string,
    value: string | number,
    field?: string,
    parent?: unknown,
  ): unknown | null | Promise<unknown | null>;
};

/** Parent instance that can scope a nested child binding. */
export type ScopedParent = {
  resolveChildRouteBinding?(
    childType: string,
    value: string | number,
    field?: string,
  ): unknown | null | Promise<unknown | null>;
  resolveSoftDeletableChildRouteBinding?(
    childType: string,
    value: string | number,
    field?: string,
  ): unknown | null | Promise<unknown | null>;
};

/** Parse `{user}` / `{user?}` / `{user:user_name}` → name, optional, binding field. */
export function parseRouteParamSegment(raw: string): {
  name: string;
  field?: string;
  optional?: boolean;
} {
  let body = raw;
  let optional = false;
  if (body.endsWith("?")) {
    optional = true;
    body = body.slice(0, -1);
  }
  const colon = body.indexOf(":");
  if (colon === -1) return { name: body, optional: optional || undefined };
  return {
    name: body.slice(0, colon),
    field: body.slice(colon + 1) || undefined,
    optional: optional || undefined,
  };
}

function resolveBoundModel(
  model: BindableModel,
  value: string,
  field?: string,
  withTrashed?: boolean,
): unknown | null | Promise<unknown | null> {
  if (
    withTrashed &&
    typeof model.resolveSoftDeletableRouteBinding === "function"
  ) {
    return model.resolveSoftDeletableRouteBinding(value, field);
  }
  if (field && typeof model.resolveRouteBinding === "function") {
    return model.resolveRouteBinding(value, field);
  }
  if (!field && typeof model.resolveRouteBinding === "function") {
    return model.resolveRouteBinding(value);
  }
  return model.find(value);
}

/** Throw 404, or the route's `missing` response when registered. */
function abortBindingMissing(
  route: RouteDefinition | undefined,
  request: Request,
): never | Promise<never> {
  if (route?.missing) {
    const result = route.missing(request);
    const throwResponse = (response: Response): never => {
      throw new HttpResponseException(response);
    };
    if (result instanceof Promise) return result.then(throwResponse);
    throwResponse(result);
  }
  abort(404);
}

function rejectIfMissing(
  resolved: unknown,
  route: RouteDefinition | undefined,
  request: Request,
): unknown | Promise<unknown> {
  if (resolved instanceof Promise) {
    return resolved.then((row) => {
      if (!row) return abortBindingMissing(route, request);
      return row;
    });
  }
  if (!resolved) return abortBindingMissing(route, request);
  return resolved;
}

/** String-enum / const-object shape used for route enum binding. */
export type StringEnumLike = Record<string, string>;

/** True when `value` looks like a TS string enum or `{ Key: "value" }` map. */
export function looksLikeStringEnum(
  value: unknown,
): value is StringEnumLike {
  if (value == null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  if (typeof (value as { find?: unknown }).find === "function") return false;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => !/^\d+$/.test(key),
  );
  if (entries.length === 0) return false;
  return entries.every(([, v]) => typeof v === "string");
}

function enumValues(enumLike: StringEnumLike): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(enumLike)) {
    if (/^\d+$/.test(key)) continue;
    if (typeof value === "string") out.add(value);
  }
  return out;
}

type GroupAttrs = {
  prefix?: string;
  middleware?: RouteMiddleware[];
  name?: string;
  domain?: string;
  /** Group-level scoped bindings. */
  scopeBindings?: boolean;
  /** Group-level soft-deleted binding. */
  withTrashed?: boolean;
};

/** Resource / apiResource action names. */
export type ResourceAction =
  | "index"
  | "create"
  | "store"
  | "show"
  | "edit"
  | "update"
  | "destroy";

/** Singleton / apiSingleton action names. */
export type SingletonAction =
  | "create"
  | "store"
  | "show"
  | "edit"
  | "update"
  | "destroy";

/** Options for `resource()` / `apiResource()`. */
export type ResourceOptions = {
  only?: readonly ResourceAction[];
  except?: readonly ResourceAction[];
  /** Per-action route names, or a string name prefix replacing the resource name. */
  names?: Partial<Record<ResourceAction, string>> | string;
  /** Map resource segment → parameter name (`{ posts: "article" }`). */
  parameters?: Readonly<Record<string, string>>;
  /** Shallow nesting for dotted nested resources (`photos.comments`). */
  shallow?: boolean;
};

/** Options for `singleton()` / `apiSingleton()`. */
export type SingletonOptions = {
  only?: readonly SingletonAction[];
  except?: readonly SingletonAction[];
  names?: Partial<Record<SingletonAction, string>> | string;
  /** Include create + store (or store for api). */
  creatable?: boolean;
  /** Include destroy. */
  destroyable?: boolean;
};

/** Callback when implicit binding finds no model. */
export type MissingBindingCallback = (
  request: Request,
) => Response | Promise<Response>;

const RESOURCE_ACTIONS: readonly ResourceAction[] = [
  "index",
  "create",
  "store",
  "show",
  "edit",
  "update",
  "destroy",
];

const API_RESOURCE_ACTIONS: readonly ResourceAction[] = [
  "index",
  "store",
  "show",
  "update",
  "destroy",
];

const SINGLETON_ACTIONS: readonly SingletonAction[] = [
  "show",
  "edit",
  "update",
];

const API_SINGLETON_ACTIONS: readonly SingletonAction[] = ["show", "update"];

export class RouteNotFoundError extends BunyadError {
  constructor(message = "Route not found.") {
    super(message, "BUNYAD_ROUTE_404");
    this.name = "RouteNotFoundError";
  }
}

const EMPTY_PARAMS: Record<string, string> = Object.freeze({});

const DEFAULT_PATTERNS: Record<string, string> = {
  // used by whereNumber / whereUuid / whereUlid helpers as presets
};

/** Renderer for `Route.view(uri, name, data)` — wired by ViewServiceProvider. */
let routeViewRenderer:
  | ((
      name: string,
      data?: Record<string, unknown>,
      status?: number,
    ) => Response | Promise<Response>)
  | null = null;

/** Register the named-view renderer used by `Route.view(uri, name, …)`. */
export function setRouteViewRenderer(
  renderer:
    | ((
        name: string,
        data?: Record<string, unknown>,
        status?: number,
      ) => Response | Promise<Response>)
    | null,
): void {
  routeViewRenderer = renderer;
}

function normalizeUri(uri: string): string {
  if (uri === "" || uri === "/") return "/";
  const withSlash = uri.startsWith("/") ? uri : `/${uri}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

function singular(name: string): string {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
}

function hostnameOf(host: string): string {
  return host.split(":")[0]!;
}

type DomainCompiled = { re: RegExp; names: string[] };

/** Compile a host pattern (`api.example.com` or `{account}.app.test`). */
function compileDomain(domain: string): DomainCompiled {
  const names: string[] = [];
  const escaped = domain
    .split(".")
    .map((part) => {
      if (part.startsWith("{") && part.endsWith("}")) {
        const { name } = parseRouteParamSegment(part.slice(1, -1));
        names.push(name);
        return "([^.]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("\\.");
  return { re: new RegExp(`^${escaped}$`, "i"), names };
}

const domainCompiledByRoute = new WeakMap<RouteDefinition, DomainCompiled>();

function domainCompiled(route: RouteDefinition): DomainCompiled | undefined {
  if (!route.domain) return undefined;
  let compiled = domainCompiledByRoute.get(route);
  if (!compiled) {
    compiled = compileDomain(route.domain);
    domainCompiledByRoute.set(route, compiled);
  }
  return compiled;
}

function domainMatches(route: RouteDefinition, host?: string): boolean {
  if (!route.domain) return true;
  if (host == null || host === "") return false;
  return domainCompiled(route)!.re.test(hostnameOf(host));
}

/**
 * Extract named domain captures into params.
 * Returns `null` when the host does not match; empty object when no domain / no captures.
 */
function extractDomainParams(
  route: RouteDefinition,
  host?: string,
): Record<string, string> | null {
  if (!route.domain) return EMPTY_PARAMS as Record<string, string>;
  if (host == null || host === "") return null;
  const compiled = domainCompiled(route)!;
  const m = hostnameOf(host).match(compiled.re);
  if (!m) return null;
  if (compiled.names.length === 0) {
    return EMPTY_PARAMS as Record<string, string>;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < compiled.names.length; i++) {
    params[compiled.names[i]!] = m[i + 1]!;
  }
  return params;
}

function mergeMatchParams(
  domainParams: Record<string, string>,
  pathParams: Record<string, string>,
): Record<string, string> {
  const domainEmpty =
    domainParams === EMPTY_PARAMS || Object.keys(domainParams).length === 0;
  const pathEmpty =
    pathParams === EMPTY_PARAMS || Object.keys(pathParams).length === 0;
  if (domainEmpty) return pathParams;
  if (pathEmpty) return domainParams;
  return { ...domainParams, ...pathParams };
}

function resourceMethods(
  defaults: readonly ResourceAction[],
  options?: ResourceOptions,
): ResourceAction[] {
  let methods = defaults.slice() as ResourceAction[];
  if (options?.only && options.only.length > 0) {
    const allow = new Set(options.only);
    methods = methods.filter((m) => allow.has(m));
  }
  if (options?.except && options.except.length > 0) {
    const deny = new Set(options.except);
    methods = methods.filter((m) => !deny.has(m));
  }
  return methods;
}

function singletonMethods(
  api: boolean,
  options?: SingletonOptions,
): SingletonAction[] {
  let methods = (
    api ? API_SINGLETON_ACTIONS : SINGLETON_ACTIONS
  ).slice() as SingletonAction[];
  if (options?.creatable) {
    if (api) {
      if (!methods.includes("store")) methods.unshift("store");
    } else {
      if (!methods.includes("create")) methods.unshift("create");
      if (!methods.includes("store")) {
        const createIdx = methods.indexOf("create");
        methods.splice(createIdx + 1, 0, "store");
      }
    }
  }
  if (options?.destroyable && !methods.includes("destroy")) {
    methods.push("destroy");
  }
  if (options?.only && options.only.length > 0) {
    const allow = new Set(options.only);
    methods = methods.filter((m) => allow.has(m));
  }
  if (options?.except && options.except.length > 0) {
    const deny = new Set(options.except);
    methods = methods.filter((m) => !deny.has(m));
  }
  return methods;
}

function singletonRouteName(
  resource: string,
  method: SingletonAction,
  options?: SingletonOptions,
): string {
  if (options?.names) {
    if (typeof options.names === "string") {
      return `${options.names}.${method}`;
    }
    const custom = options.names[method];
    if (custom) return custom;
  }
  return `${resource}.${method}`;
}

function resourceWildcard(
  segment: string,
  parameters?: Readonly<Record<string, string>>,
): string {
  if (parameters && parameters[segment] != null) {
    return parameters[segment]!.replace(/-/g, "_");
  }
  return singular(segment).replace(/-/g, "_");
}

/** Nested resource URI without the final `{param}`. */
function resourceCollectionUri(
  name: string,
  parameters?: Readonly<Record<string, string>>,
): string {
  if (!name.includes(".")) return name;
  const segments = name.split(".");
  const nested = segments
    .map((s) => `${s}/{${resourceWildcard(s, parameters)}}`)
    .join("/");
  const last = resourceWildcard(segments[segments.length - 1]!, parameters);
  return nested.replace(`/{${last}}`, "");
}

function resourceRouteName(
  resource: string,
  method: ResourceAction,
  options?: ResourceOptions,
): string {
  if (options?.names) {
    if (typeof options.names === "string") {
      return `${options.names}.${method}`;
    }
    const custom = options.names[method];
    if (custom) return custom;
  }
  return `${resource}.${method}`;
}

function nameMatches(name: string | undefined, patterns: string[]): boolean {
  if (!name) return false;
  for (const pattern of patterns) {
    if (pattern === name) return true;
    if (!pattern.includes("*")) continue;
    const re: RegExp = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    if (re.test(name)) return true;
  }
  return false;
}

function compileUri(
  uri: string,
  wheres: Record<string, string> = {},
  patterns: Record<string, string> = {},
): {
  regex: RegExp;
  paramNames: string[];
  bindingFields: Record<string, string>;
} {
  const paramNames: string[] = [];
  const bindingFields: Record<string, string> = {};
  const normalized = normalizeUri(uri);
  const segments =
    normalized === "/" ? [] : normalized.replace(/^\//, "").split("/");
  let sawOptional = false;
  const out: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const { name, field, optional } = parseRouteParamSegment(
        segment.slice(1, -1),
      );
      if (sawOptional && !optional) {
        throw new Error(
          `Optional route parameter must be trailing; required {${name}} follows an optional segment in [${uri}].`,
        );
      }
      if (optional && i !== segments.length - 1) {
        throw new Error(
          `Optional route parameter {${name}?} must be the last URI segment in [${uri}].`,
        );
      }
      if (optional) sawOptional = true;
      paramNames.push(name);
      if (field) bindingFields[name] = field;
      const constraint =
        wheres[name] ?? patterns[name] ?? DEFAULT_PATTERNS[name] ?? "[^/]+";
      const capture = `(${constraint})`;
      out.push(optional ? `(?:/${capture})?` : `/${capture}`);
    } else {
      if (sawOptional) {
        throw new Error(
          `Optional route parameter must be trailing in [${uri}].`,
        );
      }
      out.push(`/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    }
  }

  const pattern = out.join("");
  return {
    regex: new RegExp(`^${pattern === "" ? "/" : pattern}$`),
    paramNames,
    bindingFields,
  };
}

/**
 * HTTP router with named routes, groups, resources, and bindings.
 */
export class Router {
  readonly routes: RouteDefinition[] = [];
  readonly #named = new Map<string, RouteDefinition>();
  /** Static URI → candidates (multiple when domains differ). */
  readonly #static = new Map<string, Map<string, RouteDefinition[]>>();
  readonly #dynamic = new Map<string, RouteDefinition[]>();
  readonly #binders = new Map<string, RouteBinder>();
  readonly #models = new Map<string, BindableModel>();
  readonly #patterns = new Map<string, string>();
  #fallback: RouteDefinition | undefined;
  #groupStack: GroupAttrs[] = [];
  /** Per-method radix trees when `optimize()` has been called. */
  #radix: Map<string, RadixNode> | undefined;
  #current:
    | { route: RouteDefinition; params: Record<string, string> }
    | undefined;
  #hotMethod = "";
  #hotPath = "";
  #hotHost: string | undefined;
  #hotHit:
    | { route: RouteDefinition; params: Record<string, string> }
    | undefined;
  #hotHas = false;

  get(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["GET", "HEAD"], uri, action);
  }

  post(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["POST"], uri, action);
  }

  put(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["PUT"], uri, action);
  }

  patch(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["PATCH"], uri, action);
  }

  delete(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["DELETE"], uri, action);
  }

  options(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(["OPTIONS"], uri, action);
  }

  /** Register a route for multiple HTTP verbs. */
  match(methods: string[], uri: string, action: RouteAction): RouteRegistrar;
  match(
    method: string,
    path: string,
    host?: string,
  ): { route: RouteDefinition; params: Record<string, string> } | undefined;
  match(
    methodsOrMethod: string[] | string,
    uriOrPath: string,
    actionOrHost?: RouteAction | string,
  ):
    | RouteRegistrar
    | { route: RouteDefinition; params: Record<string, string> }
    | undefined {
    if (Array.isArray(methodsOrMethod)) {
      return this.add(
        methodsOrMethod.map((m) => m.toUpperCase()),
        uriOrPath,
        actionOrHost as RouteAction,
      );
    }
    return this.#matchRequest(
      methodsOrMethod,
      uriOrPath,
      typeof actionOrHost === "string" ? actionOrHost : undefined,
    );
  }

  any(uri: string, action: RouteAction): RouteRegistrar {
    return this.add(
      ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      uri,
      action,
    );
  }

  /** Register a redirect response for the given URI. */
  redirect(uri: string, destination: string, status = 302): RouteRegistrar {
    const registrar = this.any(uri, () => redirect(destination, status));
    this.routes.at(-1)!.declaration = { kind: "redirect", to: destination, status };
    return registrar;
  }

  permanentRedirect(uri: string, destination: string): RouteRegistrar {
    return this.redirect(uri, destination, 301);
  }

  /** Register a GET route that returns an HTML body from `render`. */
  view(
    uri: string,
    render: (request: Request) => string | Promise<string>,
    status?: number,
  ): RouteRegistrar;
  /** Register a GET route that renders a named view. */
  view(
    uri: string,
    name: string,
    data?: Record<string, unknown>,
    status?: number,
  ): RouteRegistrar;
  view(
    uri: string,
    renderOrName:
      | string
      | ((request: Request) => string | Promise<string>),
    dataOrStatus: Record<string, unknown> | number = 200,
    status = 200,
  ): RouteRegistrar {
    if (typeof renderOrName === "string") {
      const name = renderOrName;
      const data =
        typeof dataOrStatus === "object" && dataOrStatus !== null
          ? dataOrStatus
          : {};
      const code = typeof dataOrStatus === "number" ? dataOrStatus : status;
      const registrar = this.get(uri, async () => {
        if (!routeViewRenderer) {
          throw new BunyadError(
            "Route.view(name) requires a view renderer. Register ViewServiceProvider or call setRouteViewRenderer.",
            "BUNYAD_ROUTE_003",
          );
        }
        return routeViewRenderer(name, data, code);
      });
      this.routes.at(-1)!.declaration = { kind: "view", view: name, data, status: code };
      return registrar;
    }
    const render = renderOrName;
    const code = typeof dataOrStatus === "number" ? dataOrStatus : status;
    return this.get(uri, async (request) => {
      const body = await render(request);
      return new Response(body, {
        status: code,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  /**
   * Global parameter pattern (`Route.pattern('id', '[0-9]+')`).
   */
  pattern(param: string, expression: string): this {
    this.#patterns.set(param, expression);
    return this;
  }

  patterns(): ReadonlyMap<string, string> {
    return this.#patterns;
  }

  /** Full resource routes including create/edit form endpoints. */
  resource(
    name: string,
    controller: ControllerClass,
    options?: ResourceOptions,
  ): void {
    this.#registerResource(name, controller, options, false);
  }

  /** API resource — index/store/show/update/destroy (no create/edit). */
  apiResource(
    name: string,
    controller: ControllerClass,
    options?: ResourceOptions,
  ): void {
    this.#registerResource(name, controller, options, true);
  }

  /** Register multiple resource controllers: `{ posts: PostController }`. */
  resources(
    resources: Record<string, ControllerClass>,
    options?: ResourceOptions,
  ): void {
    for (const [name, controller] of Object.entries(resources)) {
      this.resource(name, controller, options);
    }
  }

  /** Register multiple API resource controllers. */
  apiResources(
    resources: Record<string, ControllerClass>,
    options?: ResourceOptions,
  ): void {
    for (const [name, controller] of Object.entries(resources)) {
      this.apiResource(name, controller, options);
    }
  }

  /** Single-resource routes (`GET/PUT /profile`, `GET /profile/edit`, …). */
  singleton(
    name: string,
    controller: ControllerClass,
    options?: SingletonOptions,
  ): SingletonRegistrar {
    return this.#registerSingleton(name, controller, options, false);
  }

  /** API singleton — show/update (plus optional store/destroy). */
  apiSingleton(
    name: string,
    controller: ControllerClass,
    options?: SingletonOptions,
  ): SingletonRegistrar {
    return this.#registerSingleton(name, controller, options, true);
  }

  #registerSingleton(
    name: string,
    controller: ControllerClass,
    options: SingletonOptions | undefined,
    api: boolean,
  ): SingletonRegistrar {
    const registrar = new SingletonRegistrar(this, name, controller, api, {
      ...options,
    });
    registrar.register();
    return registrar;
  }

  /**
   * `Route::resource` / `apiResource` registration with options:
   * `only`, `except`, `names`, `parameters`, `shallow`.
   */
  #registerResource(
    name: string,
    controller: ControllerClass,
    options: ResourceOptions | undefined,
    api: boolean,
  ): void {
    const raw = name.replace(/^\/|\/$/g, "");
    const actions = resourceMethods(
      api ? API_RESOURCE_ACTIONS : RESOURCE_ACTIONS,
      options,
    );
    if (actions.length === 0) return;

    const parameters = options?.parameters;
    const nested = raw.includes(".");
    const shallow = Boolean(options?.shallow && nested);
    const segments = raw.split(".");
    const leaf = segments[segments.length - 1]!;
    const param = resourceWildcard(leaf, parameters);
    const collectionUri = resourceCollectionUri(raw, parameters);
    // Member routes: shallow drops parent segments from the URI name.
    const memberName = shallow ? leaf : raw;
    const memberUri = resourceCollectionUri(memberName, parameters);

    const nameFor = (action: ResourceAction, uriName: string): string =>
      resourceRouteName(uriName, action, options);

    for (const action of actions) {
      switch (action) {
        case "index":
          this.get(`/${collectionUri}`, [controller, "index"]).name(
            nameFor("index", raw),
          );
          break;
        case "create":
          this.get(`/${collectionUri}/create`, [controller, "create"]).name(
            nameFor("create", raw),
          );
          break;
        case "store":
          this.post(`/${collectionUri}`, [controller, "store"]).name(
            nameFor("store", raw),
          );
          break;
        case "show":
          this.get(`/${memberUri}/{${param}}`, [controller, "show"]).name(
            nameFor("show", memberName),
          );
          break;
        case "edit":
          this.get(`/${memberUri}/{${param}}/edit`, [controller, "edit"]).name(
            nameFor("edit", memberName),
          );
          break;
        case "update": {
          const named = this.put(`/${memberUri}/{${param}}`, [
            controller,
            "update",
          ]).name(nameFor("update", memberName));
          this.patch(`/${memberUri}/{${param}}`, [controller, "update"]);
          void named;
          break;
        }
        case "destroy":
          this.delete(`/${memberUri}/{${param}}`, [controller, "destroy"]).name(
            nameFor("destroy", memberName),
          );
          break;
      }
    }
  }

  /**
   * Fallback action when no other route matches.
   * Register last.
   */
  fallback(action: RouteAction): RouteRegistrar {
    const route: RouteDefinition = {
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      uri: "/{fallback}",
      action: resolveControllerAction(action),
      middleware: [],
      paramNames: [],
      bindingFields: {},
      wheres: {},
      regex: /^.*$/,
    };
    this.#fallback = route;
    this.routes.push(route);
    this.#invalidateHot();
    if (this.#radix) this.optimize();
    return new RouteRegistrar(this, route);
  }

  clear(): void {
    this.routes.length = 0;
    this.#named.clear();
    this.#static.clear();
    this.#dynamic.clear();
    this.#binders.clear();
    this.#models.clear();
    this.#patterns.clear();
    this.#fallback = undefined;
    this.#groupStack = [];
    this.#radix = undefined;
    this.#current = undefined;
    this.#invalidateHot();
  }

  /**
   * Build per-method radix trees for O(segments) matching instead of
   * linear dynamic scans. Call after all routes are registered (`bunyad compile` optimizes by default).
   */
  optimize(): this {
    this.#invalidateHot();
    this.#radix = buildRadixTrees(this.routes, this.#patterns, this.#fallback);
    return this;
  }

  /** Custom route parameter binder (`Route.bind("user", id => ...)`). */
  bind(param: string, resolver: RouteBinder): this {
    this.#binders.set(param, resolver);
    return this;
  }

  /** Implicit model binding (`Route.model("post", Post)` → 404 if missing). */
  model(param: string, model: BindableModel): this {
    this.#models.set(param, model);
    return this.bind(param, (value, request) => {
      const current = this.#current?.route;
      const field = current?.bindingFields[param];
      const row = resolveBoundModel(
        model,
        value,
        field,
        current?.withTrashed === true,
      );
      return rejectIfMissing(row, current, request);
    });
  }

  /** Like `model`, but does not replace an existing binder (convention / scan). */
  modelIfAbsent(param: string, model: BindableModel): this {
    if (this.#binders.has(param)) return this;
    return this.model(param, model);
  }

  /**
   * Bind a URI segment to a string enum / const-object value (404 when unknown).
   */
  enum(param: string, enumLike: StringEnumLike): this {
    const allowed = enumValues(enumLike);
    return this.bind(param, (value, request) => {
      if (!allowed.has(value)) {
        return abortBindingMissing(this.#current?.route, request);
      }
      return value;
    });
  }

  /** Like `enum`, but does not replace an existing binder. */
  enumIfAbsent(param: string, enumLike: StringEnumLike): this {
    if (this.#binders.has(param)) return this;
    return this.enum(param, enumLike);
  }

  /** Whether a binder is registered for `param`. */
  hasBinder(param: string): boolean {
    return this.#binders.has(param);
  }

  /** Stamp a precomputed inject plan onto a route (boot/compile). */
  setInject(route: RouteDefinition, slots: InjectSlot[]): void {
    route.inject = slots;
  }

  /** Registered `Route.model` bindings (for the compiler). */
  models(): ReadonlyMap<string, BindableModel> {
    return this.#models;
  }

  /** Resolve registered binders onto `request.model(param)`. */
  resolveBindings(request: Request): void | Promise<void> {
    if (this.#binders.size === 0) return;
    const params = request.route() as Record<string, string>;
    const route = this.#current?.route;
    // Prefer route param order so parents resolve before nested children.
    const ordered: string[] = [];
    if (route && route.paramNames.length > 0) {
      for (const name of route.paramNames) {
        if (this.#binders.has(name) && name in params) ordered.push(name);
      }
    }
    // Domain captures (and any extras) not listed on the URI.
    for (const key in params) {
      if (this.#binders.has(key) && !ordered.includes(key)) ordered.push(key);
    }
    if (ordered.length === 0) return;

    const shouldScope = (param: string): boolean => {
      if (!route) return false;
      if (route.scopeBindings === false) return false;
      if (route.scopeBindings === true) return true;
      // Default: scope when a custom binding field is present.
      return Object.prototype.hasOwnProperty.call(route.bindingFields, param);
    };

    const resolveOne = (
      key: string,
      index: number,
    ): unknown | Promise<unknown> => {
      const value = params[key]!;
      const field = route?.bindingFields[key];
      if (shouldScope(key) && index > 0) {
        // Immediate parent of this parameter.
        const parentKey = ordered[index - 1]!;
        const parent = request.model(parentKey) as ScopedParent | undefined;
        const allowTrashed = route?.withTrashed === true;
        if (parent) {
          const parentResolve =
            allowTrashed &&
            typeof parent.resolveSoftDeletableChildRouteBinding === "function"
              ? parent.resolveSoftDeletableChildRouteBinding.bind(parent)
              : typeof parent.resolveChildRouteBinding === "function"
                ? parent.resolveChildRouteBinding.bind(parent)
                : null;
          if (parentResolve) {
            return rejectIfMissing(
              parentResolve(key, value, field),
              route,
              request,
            );
          }
        }
        const childModel = this.#models.get(key);
        if (childModel) {
          const modelResolve =
            allowTrashed &&
            typeof childModel.resolveSoftDeletableChildRouteBinding ===
              "function"
              ? childModel.resolveSoftDeletableChildRouteBinding.bind(childModel)
              : typeof childModel.resolveChildRouteBinding === "function"
                ? childModel.resolveChildRouteBinding.bind(childModel)
                : null;
          if (modelResolve) {
            return rejectIfMissing(
              modelResolve(key, value, field, parent),
              route,
              request,
            );
          }
        }
      }
      return this.#binders.get(key)!(value, request);
    };

    for (let i = 0; i < ordered.length; i++) {
      const key = ordered[i]!;
      const result = resolveOne(key, i);
      if (result instanceof Promise) {
        return (async () => {
          request.setModel(key, await result);
          for (let j = i + 1; j < ordered.length; j++) {
            const nextKey = ordered[j]!;
            request.setModel(nextKey, await resolveOne(nextKey, j));
          }
        })();
      }
      request.setModel(key, result);
    }
  }

  /** True when any of `paramNames` has a registered binder. */
  hasBindings(paramNames: readonly string[]): boolean {
    if (this.#binders.size === 0 || paramNames.length === 0) return false;
    for (let i = 0; i < paramNames.length; i++) {
      if (this.#binders.has(paramNames[i]!)) return true;
    }
    return false;
  }

  namedRoutes(): ReadonlyMap<string, RouteDefinition> {
    return this.#named;
  }

  /** Whether a named route is registered. */
  has(name: string): boolean {
    return this.#named.has(name);
  }

  /** All registered route definitions. */
  getRoutes(): readonly RouteDefinition[] {
    return this.routes;
  }

  /** Currently matched route (set by `match`). */
  current(): RouteDefinition | undefined {
    return this.#current?.route;
  }

  currentRouteName(): string | undefined {
    return this.#current?.route.name;
  }

  /**
   * Current action label: `Controller@method`, or `"Closure"` for functions.
   */
  currentRouteAction(): string | undefined {
    const action = this.#current?.route.action;
    if (!action) return undefined;
    if (typeof action === "function") return "Closure";
    if (Array.isArray(action)) {
      const [Controller, method] = action;
      return `${Controller.name}@${method}`;
    }
    return undefined;
  }

  currentRouteNamed(...patterns: string[]): boolean {
    return nameMatches(this.currentRouteName(), patterns);
  }

  /** Alias of `currentRouteNamed`. */
  is(...patterns: string[]): boolean {
    return this.currentRouteNamed(...patterns);
  }

  setCurrentRoute(
    route: RouteDefinition | undefined,
    params: Record<string, string> = EMPTY_PARAMS,
  ): void {
    this.#current = route ? { route, params } : undefined;
  }

  group(attributes: GroupAttrs, callback: () => void): void;
  group(attributes: GroupAttrs, callback: () => Promise<void>): Promise<void>;
  group(
    attributes: GroupAttrs,
    callback: () => void | Promise<void>,
  ): void | Promise<void> {
    this.#groupStack.push(attributes);
    try {
      const result = callback();
      if (
        result != null &&
        typeof (result as PromiseLike<void>).then === "function"
      ) {
        return Promise.resolve(result as Promise<void>).finally(() => {
          this.#groupStack.pop();
        });
      }
    } catch (error) {
      this.#groupStack.pop();
      throw error;
    }
    this.#groupStack.pop();
  }

  prefix(prefix: string): GroupBuilder {
    return new GroupBuilder(this, { prefix });
  }

  middleware(...middleware: RouteMiddleware[]): GroupBuilder {
    return new GroupBuilder(this, { middleware });
  }

  name(name: string): GroupBuilder {
    return new GroupBuilder(this, { name });
  }

  domain(domain: string): GroupBuilder {
    return new GroupBuilder(this, { domain });
  }

  /** `Route::scopeBindings()` — enforce nested child scoping for a group. */
  scopeBindings(scope = true): GroupBuilder {
    return new GroupBuilder(this, { scopeBindings: scope });
  }

  /** `Route::withoutScopedBindings()`. */
  withoutScopedBindings(): GroupBuilder {
    return new GroupBuilder(this, { scopeBindings: false });
  }

  /** `Route::withTrashed()` — include soft-deleted models in binding. */
  withTrashed(withTrashed = true): GroupBuilder {
    return new GroupBuilder(this, { withTrashed });
  }

  add(methods: string[], uri: string, action: RouteAction): RouteRegistrar {
    const merged = this.#mergeGroup(uri);
    const wheres: Record<string, string> = {};
    const patterns = Object.fromEntries(this.#patterns);
    const { regex, paramNames, bindingFields } = compileUri(
      merged.uri,
      wheres,
      patterns,
    );
    const route: RouteDefinition = {
      methods,
      uri: merged.uri,
      action: resolveControllerAction(action),
      middleware: merged.middleware,
      paramNames,
      bindingFields,
      wheres,
      regex,
      name: merged.name,
      domain: merged.domain,
      scopeBindings: merged.scopeBindings,
      withTrashed: merged.withTrashed,
    };
    this.routes.push(route);

    for (const method of methods) {
      if (paramNames.length === 0) {
        let bucket = this.#static.get(method);
        if (!bucket) {
          bucket = new Map();
          this.#static.set(method, bucket);
        }
        const list = bucket.get(merged.uri) ?? [];
        list.push(route);
        bucket.set(merged.uri, list);
      } else {
        let list = this.#dynamic.get(method);
        if (!list) {
          list = [];
          this.#dynamic.set(method, list);
        }
        list.push(route);
      }
    }

    this.#invalidateHot();
    if (this.#radix) this.optimize();
    return new RouteRegistrar(this, route);
  }

  /** Recompile a route after `where` constraints change. */
  recompile(route: RouteDefinition): void {
    const patterns = Object.fromEntries(this.#patterns);
    const compiled = compileUri(route.uri, route.wheres, patterns);
    route.regex = compiled.regex;
    route.paramNames = compiled.paramNames;
    route.bindingFields = compiled.bindingFields;
    this.#invalidateHot();
    if (this.#radix) this.optimize();
  }

  registerName(name: string, route: RouteDefinition): void {
    if (this.#named.has(name)) {
      throw new BunyadError(
        `Unable to register route [${name}] — name already used.`,
        "BUNYAD_ROUTE_001",
      );
    }
    route.name = name;
    this.#named.set(name, route);
  }

  route(
    name: string,
    params: Record<string, RouteParamValue> = {},
    absolute = false,
  ): string {
    const route = this.#named.get(name);
    if (!route) {
      throw new RouteNotFoundError(`Route [${name}] not defined.`);
    }
    const merged = normalizeRouteParams({
      ...getUrlDefaults(),
      ...params,
    });
    const path = formatPathWithParams(route.uri, merged);
    if (!absolute) return path;
    const root = (process.env.APP_URL ?? "http://localhost").replace(/\/$/, "");
    return `${root}${path}`;
  }

  #invalidateHot(): void {
    this.#hotHas = false;
  }

  #rememberHot(
    verb: string,
    path: string,
    host: string | undefined,
    hit: { route: RouteDefinition; params: Record<string, string> } | undefined,
  ): { route: RouteDefinition; params: Record<string, string> } | undefined {
    this.#hotHas = true;
    this.#hotMethod = verb;
    this.#hotPath = path;
    this.#hotHost = host;
    this.#hotHit = hit;
    this.#current = hit;
    return hit;
  }

  #matchRequest(
    method: string,
    path: string,
    host?: string,
  ): { route: RouteDefinition; params: Record<string, string> } | undefined {
    const normalized =
      path === "/" || path.charCodeAt(0) === 47
        ? path.length > 1 && path.charCodeAt(path.length - 1) === 47
          ? path.slice(0, -1)
          : path
        : normalizeUri(path);
    const verb =
      method === "GET" ||
      method === "POST" ||
      method === "PUT" ||
      method === "PATCH" ||
      method === "DELETE" ||
      method === "HEAD" ||
      method === "OPTIONS"
        ? method
        : method.toUpperCase();

    if (
      this.#hotHas &&
      this.#hotMethod === verb &&
      this.#hotPath === normalized &&
      this.#hotHost === host
    ) {
      this.#current = this.#hotHit;
      return this.#hotHit;
    }

    if (host != null && host !== "") {
      const domainHit = this.#matchLinear(verb, normalized, host, true);
      if (domainHit) {
        return this.#rememberHot(verb, normalized, host, domainHit);
      }
    }

    if (this.#radix) {
      const root = this.#radix.get(verb);
      if (root) {
        const hit = matchRadix(root, normalized);
        if (hit && (!hit.route.domain || domainMatches(hit.route, host))) {
          return this.#rememberHot(verb, normalized, host, hit);
        }
      }
      const linear = this.#matchLinear(verb, normalized, host, false);
      if (linear) {
        return this.#rememberHot(verb, normalized, host, linear);
      }
      if (this.#fallback && this.#fallback.methods.includes(verb)) {
        return this.#rememberHot(verb, normalized, host, {
          route: this.#fallback,
          params: EMPTY_PARAMS,
        });
      }
      return this.#rememberHot(verb, normalized, host, undefined);
    }

    const exactList = this.#static.get(verb)?.get(normalized);
    if (exactList) {
      for (const route of exactList) {
        if (route.domain) continue;
        return this.#rememberHot(verb, normalized, host, {
          route,
          params: EMPTY_PARAMS,
        });
      }
    }

    const dynamic = this.#dynamic.get(verb);
    if (dynamic) {
      for (const route of dynamic) {
        if (route.domain) continue;
        if (!domainMatches(route, host)) continue;
        const m = normalized.match(route.regex);
        if (!m) continue;
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          const value = m[i + 1];
          if (value !== undefined) params[route.paramNames[i]!] = value;
        }
        return this.#rememberHot(verb, normalized, host, { route, params });
      }
    }

    if (this.#fallback && this.#fallback.methods.includes(verb)) {
      return this.#rememberHot(verb, normalized, host, {
        route: this.#fallback,
        params: EMPTY_PARAMS,
      });
    }

    return this.#rememberHot(verb, normalized, host, undefined);
  }

  #matchLinear(
    verb: string,
    normalized: string,
    host?: string,
    domainOnly = false,
  ): { route: RouteDefinition; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route === this.#fallback) continue;
      if (!route.methods.includes(verb)) continue;
      if (domainOnly && !route.domain) continue;
      if (!domainOnly && route.domain) continue;
      const domainParams = extractDomainParams(route, host);
      if (domainParams === null) continue;
      if (route.paramNames.length === 0) {
        if (route.uri === normalized) {
          return {
            route,
            params: mergeMatchParams(domainParams, EMPTY_PARAMS as Record<string, string>),
          };
        }
        continue;
      }
      const m = normalized.match(route.regex);
      if (!m) continue;
      const pathParams: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        const value = m[i + 1];
        if (value !== undefined) pathParams[route.paramNames[i]!] = value;
      }
      return {
        route,
        params: mergeMatchParams(domainParams, pathParams),
      };
    }
    return undefined;
  }

  #mergeGroup(uri: string): {
    uri: string;
    middleware: RouteMiddleware[];
    name?: string;
    domain?: string;
    scopeBindings?: boolean;
    withTrashed?: boolean;
  } {
    let prefix = "";
    let namePrefix = "";
    let domain: string | undefined;
    let scopeBindings: boolean | undefined;
    let withTrashed: boolean | undefined;
    const middleware: RouteMiddleware[] = [];

    for (const group of this.#groupStack) {
      if (group.prefix) {
        prefix += `/${group.prefix.replace(/^\/|\/$/g, "")}`;
      }
      if (group.name) namePrefix += group.name;
      if (group.middleware) middleware.push(...group.middleware);
      if (group.domain) domain = group.domain;
      if (group.scopeBindings !== undefined) {
        scopeBindings = group.scopeBindings;
      }
      if (group.withTrashed !== undefined) {
        withTrashed = group.withTrashed;
      }
    }

    const full = normalizeUri(`${prefix}/${uri.replace(/^\//, "")}`);
    return {
      uri: full,
      middleware,
      name: namePrefix || undefined,
      domain,
      scopeBindings,
      withTrashed,
    };
  }

}

/** Pending registration for `singleton` / `apiSingleton` (supports creatable/destroyable). */
class SingletonRegistrar {
  #registered = new Set<SingletonAction>();

  constructor(
    private router: Router,
    private name: string,
    private controller: ControllerClass,
    private api: boolean,
    private options: SingletonOptions,
  ) {}

  creatable(creatable = true): this {
    this.options.creatable = creatable;
    this.#ensureActions();
    return this;
  }

  destroyable(destroyable = true): this {
    this.options.destroyable = destroyable;
    this.#ensureActions();
    return this;
  }

  /** Register routes for the current options (idempotent per action). */
  register(): void {
    this.#ensureActions();
  }

  #ensureActions(): void {
    const raw = this.name.replace(/^\/|\/$/g, "");
    const uri = `/${raw}`;
    for (const action of singletonMethods(this.api, this.options)) {
      if (this.#registered.has(action)) continue;
      this.#registered.add(action);
      const routeName = singletonRouteName(raw, action, this.options);
      if (this.router.has(routeName)) {
        this.#registered.add(action);
        continue;
      }
      switch (action) {
        case "create":
          this.router
            .get(`${uri}/create`, [this.controller, "create"])
            .name(routeName);
          break;
        case "store":
          this.router.post(uri, [this.controller, "store"]).name(routeName);
          break;
        case "show":
          this.router.get(uri, [this.controller, "show"]).name(routeName);
          break;
        case "edit":
          this.router
            .get(`${uri}/edit`, [this.controller, "edit"])
            .name(routeName);
          break;
        case "update": {
          this.router.put(uri, [this.controller, "update"]).name(routeName);
          this.router.patch(uri, [this.controller, "update"]);
          break;
        }
        case "destroy":
          this.router
            .delete(uri, [this.controller, "destroy"])
            .name(routeName);
          break;
      }
    }
  }
}

class GroupBuilder {
  constructor(
    private router: Router,
    private attrs: GroupAttrs,
  ) {}

  prefix(prefix: string): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      prefix: [this.attrs.prefix, prefix].filter(Boolean).join("/"),
    });
  }

  middleware(...middleware: RouteMiddleware[]): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      middleware: [...(this.attrs.middleware ?? []), ...middleware],
    });
  }

  name(name: string): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      name: `${this.attrs.name ?? ""}${name}`,
    });
  }

  domain(domain: string): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      domain,
    });
  }

  scopeBindings(scope = true): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      scopeBindings: scope,
    });
  }

  withoutScopedBindings(): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      scopeBindings: false,
    });
  }

  withTrashed(withTrashed = true): GroupBuilder {
    return new GroupBuilder(this.router, {
      ...this.attrs,
      withTrashed,
    });
  }

  group(callback: () => void): void;
  group(callback: () => Promise<void>): Promise<void>;
  group(callback: () => void | Promise<void>): void | Promise<void> {
    return this.router.group(this.attrs, callback);
  }
}

class RouteRegistrar {
  constructor(
    private router: Router,
    private route: RouteDefinition,
  ) {}

  name(name: string): this {
    const prefix = this.route.name ?? "";
    this.router.registerName(`${prefix}${name}`, this.route);
    return this;
  }

  domain(domain: string): this {
    this.route.domain = domain;
    return this;
  }

  /** `->scopeBindings()` — enforce nested child model scoping. */
  scopeBindings(scope = true): this {
    this.route.scopeBindings = scope;
    return this;
  }

  /** `->withoutScopedBindings()`. */
  withoutScopedBindings(): this {
    this.route.scopeBindings = false;
    return this;
  }

  /** `->withTrashed()` — include soft-deleted models in binding. */
  withTrashed(withTrashed = true): this {
    this.route.withTrashed = withTrashed;
    return this;
  }

  /** `allowsTrashedBindings()`. */
  allowsTrashedBindings(): boolean {
    return this.route.withTrashed === true;
  }

  middleware(...middleware: RouteMiddleware[]): this {
    this.route.middleware.push(...middleware);
    return this;
  }

  /**
   * Serialize concurrent requests for the same session id.
   * Requires Cache + `startSession` on the route. Defaults: hold 10s, wait 10s.
   */
  block(lockSeconds = 10, waitSeconds = 10): this {
    return this.middleware(`block:${lockSeconds},${waitSeconds}`);
  }

  /** Called when implicit binding finds no model — response replaces the 404. */
  missing(callback: MissingBindingCallback): this {
    this.route.missing = callback;
    return this;
  }

  /**
   * Parameter constraints.
   * `where('id', '[0-9]+')` or `where({ id: '[0-9]+' })`.
   */
  where(nameOrMap: string | Record<string, string>, expression?: string): this {
    if (typeof nameOrMap === "string") {
      this.route.wheres[nameOrMap] = expression ?? "[^/]+";
    } else {
      Object.assign(this.route.wheres, nameOrMap);
    }
    this.router.recompile(this.route);
    return this;
  }

  whereNumber(...params: string[]): this {
    for (const param of params) this.where(param, "[0-9]+");
    return this;
  }

  /**
   * Constrain a parameter to an allow-list (`whereIn('status', ['draft', 'live'])`).
   */
  whereIn(param: string, values: readonly (string | number)[]): this {
    const alternation = values
      .map((v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    return this.where(param, alternation.length > 0 ? alternation : "(?!)");
  }

  whereAlpha(...params: string[]): this {
    for (const param of params) this.where(param, "[a-zA-Z]+");
    return this;
  }

  whereAlphaNumeric(...params: string[]): this {
    for (const param of params) this.where(param, "[a-zA-Z0-9]+");
    return this;
  }

  whereUuid(...params: string[]): this {
    for (const param of params) {
      this.where(
        param,
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
      );
    }
    return this;
  }

  /** `whereUlid` — Crockford base32, 26 chars. */
  whereUlid(...params: string[]): this {
    for (const param of params) {
      this.where(param, "[0-7][0-9A-HJKMNP-TV-Z]{25}");
    }
    return this;
  }

  /** Stamp a precomputed inject plan (boot/compile — never classify per request). */
  inject(slots: InjectSlot[]): this {
    this.router.setInject(this.route, slots);
    return this;
  }
}

/** Underlying default router (Application uses this when no router is passed). */
const defaultRouter = new Router();

/** Router used by `route()` / `Url.*` and by the `Route` façade. */
let activeRouter: Router = defaultRouter;

/**
 * `Route` façade — forwards to the active router so side-effect
 * `Route.get(...)` in route files registers on the app router during load.
 */
export const Route: Router = new Proxy(defaultRouter, {
  get(_target, prop, _receiver) {
    const current = activeRouter;
    const value = Reflect.get(current as object, prop, current);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(current)
      : value;
  },
  set(_target, prop, value) {
    return Reflect.set(activeRouter as object, prop, value);
  },
  has(_target, prop) {
    return Reflect.has(activeRouter as object, prop);
  },
}) as Router;

/** Point named URL generation (and the Route façade) at the application router. */
export function setActiveRouter(router: Router): void {
  activeRouter = router === Route ? defaultRouter : router;
}

export function getActiveRouter(): Router {
  return activeRouter;
}

/** Default router instance used when Application is constructed without a router. */
export function getDefaultRouter(): Router {
  return defaultRouter;
}

export function route(
  name: string,
  params?: Record<string, RouteParamValue>,
  absolute = false,
): string {
  return activeRouter.route(name, params, absolute);
}
