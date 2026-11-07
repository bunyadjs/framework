import { Request as BunyadRequest, type Request } from "./request.ts";
import type { Middleware, Next } from "./pipeline.ts";
import { withHeaders } from "./response-headers.ts";

export type CorsConfig = {
  /** Path patterns relative to the app root (`api/*`, `*`). Empty = no CORS. */
  paths?: string[];
  allowed_methods?: string[];
  /**
   * Origins that may call the API. Default: none.
   *
   * Each entry is an exact origin (`https://app.example.com`, `tauri://localhost`), a pattern with
   * a wildcard host (`https://*.example.com`: any subdomain, never the bare domain) and/or port
   * (`http://localhost:*`: any port or none), or a lone `*` for every origin. `*` cannot be
   * combined with `supports_credentials`.
   */
  allowed_origins?: string[];
  /** Regular expressions tested against the whole origin. Compiled once. */
  allowed_origins_patterns?: string[];
  /** Last say on an origin the list and patterns did not allow. Runs per request, so keep it cheap. */
  allowed_origins_callback?: (origin: string, request?: Request) => boolean;
  allowed_headers?: string[];
  exposed_headers?: string[];
  /** Seconds a browser may cache a preflight answer. Default 600; 0 sends no header. */
  max_age?: number;
  supports_credentials?: boolean;
  /** Answer Chrome's private-network preflight (`Access-Control-Request-Private-Network`). Default false. */
  allow_private_network?: boolean;
};

const DEFAULT_CORS: Required<
  Pick<
    CorsConfig,
    | "paths"
    | "allowed_methods"
    | "allowed_origins"
    | "allowed_origins_patterns"
    | "allowed_headers"
    | "exposed_headers"
    | "max_age"
    | "supports_credentials"
    | "allow_private_network"
  >
> = {
  paths: ["api/*", "auth/csrf-cookie"],
  allowed_methods: ["*"],
  allowed_origins: [],
  allowed_origins_patterns: [],
  allowed_headers: ["*"],
  exposed_headers: [],
  max_age: 600,
  supports_credentials: false,
  allow_private_network: false,
};

let corsConfig: CorsConfig = { ...DEFAULT_CORS };
/** Bumped whenever the bound config changes, so compiled matchers are rebuilt. */
let corsVersion = 0;

/** A lone `*` allows every origin, which a browser must never combine with credentials. */
function assertSafe(config: CorsConfig): void {
  if (config.supports_credentials && (config.allowed_origins ?? []).includes("*")) {
    throw new Error(
      'CORS: allowed_origins "*" cannot be combined with supports_credentials. ' +
        "List the origins, or use a pattern such as https://*.example.com.",
    );
  }
}

/** Bound by HttpServiceProvider from `config/cors.ts`. */
export function setCorsConfig(config: CorsConfig | undefined): void {
  const merged = { ...DEFAULT_CORS, ...(config ?? {}) };
  assertSafe(merged);
  corsConfig = merged;
  corsVersion++;
}

export function getCorsConfig(): CorsConfig {
  return corsConfig;
}

// --- origin matching --------------------------------------------------------------------------

type OriginPattern = {
  scheme: string;
  /** Exact host, or the suffix (with its leading dot) when the pattern starts with `*.`. */
  host: string;
  subdomains: boolean;
  /** `null` = no port, `"*"` = any port or none, otherwise exact. */
  port: string | null;
};

const ORIGIN_SHAPE = /^([a-z][a-z0-9+.-]*):\/\/(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::(\d{1,5}))?$/i;
const PATTERN_SHAPE = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::(\d{1,5}|\*))?$/i;

type CompiledOrigins = {
  any: boolean;
  exact: Set<string>;
  patterns: OriginPattern[];
  regexes: RegExp[];
  callback: CorsConfig["allowed_origins_callback"];
  /** The answer depends on the request's origin, so responses must say `Vary: Origin`. */
  varies: boolean;
  memo: Map<string, boolean>;
};

const MEMO_LIMIT = 1024;

function compileOrigins(config: CorsConfig): CompiledOrigins {
  const exact = new Set<string>();
  const patterns: OriginPattern[] = [];
  let any = false;
  for (const entry of config.allowed_origins ?? []) {
    if (entry === "*") {
      any = true;
    } else if (entry.includes("*")) {
      const match = PATTERN_SHAPE.exec(entry);
      if (match) {
        patterns.push({
          scheme: match[1]!.toLowerCase(),
          host: (match[2] ? "." : "") + match[3]!.toLowerCase(),
          subdomains: match[2] !== undefined,
          port: match[4] ?? null,
        });
      }
    } else {
      exact.add(entry);
    }
  }
  const regexes: RegExp[] = [];
  for (const source of config.allowed_origins_patterns ?? []) {
    try {
      regexes.push(new RegExp(source));
    } catch {
      // ignore invalid patterns
    }
  }
  const callback = config.allowed_origins_callback;
  const plainWildcard = any && !config.supports_credentials;
  return {
    any,
    exact,
    patterns,
    regexes,
    callback,
    varies: !plainWildcard,
    memo: new Map(),
  };
}

function matchesPattern(origin: string, patterns: OriginPattern[]): boolean {
  if (patterns.length === 0) return false;
  const parsed = ORIGIN_SHAPE.exec(origin);
  if (!parsed) return false;
  const scheme = parsed[1]!.toLowerCase();
  const host = parsed[2]!.toLowerCase();
  const port = parsed[3];
  for (const pattern of patterns) {
    if (pattern.scheme !== scheme) continue;
    if (pattern.subdomains) {
      if (host.length <= pattern.host.length || !host.endsWith(pattern.host)) continue;
    } else if (host !== pattern.host) {
      continue;
    }
    if (pattern.port === "*" || (pattern.port ?? undefined) === port) return true;
  }
  return false;
}

function decide(origin: string, compiled: CompiledOrigins, request: Request | undefined): boolean {
  if (compiled.exact.has(origin)) return true;
  if (matchesPattern(origin, compiled.patterns)) return true;
  for (const regex of compiled.regexes) if (regex.test(origin)) return true;
  if (compiled.callback) return compiled.callback(origin, request);
  return false;
}

/** The value for `Access-Control-Allow-Origin`, or `null` when the origin is not allowed. */
function originAllowed(
  origin: string | null,
  compiled: CompiledOrigins,
  request: Request | undefined,
): string | null {
  if (!origin) return null;
  if (compiled.any) return compiled.varies ? origin : "*";
  if (compiled.callback) return decide(origin, compiled, request) ? origin : null;
  // Without a callback the answer depends on the origin alone, so it can be remembered.
  const known = compiled.memo.get(origin);
  if (known !== undefined) return known ? origin : null;
  const result = decide(origin, compiled, request);
  if (compiled.memo.size >= MEMO_LIMIT) compiled.memo.clear();
  compiled.memo.set(origin, result);
  return result ? origin : null;
}

const compiledForConfig = new WeakMap<CorsConfig, { origins: CompiledOrigins }>();

/** Compile a full config once and remember it by object, so repeated checks do not rebuild it. */
function compileFor(config: CorsConfig): { origins: CompiledOrigins } {
  let compiled = compiledForConfig.get(config);
  if (!compiled) {
    const merged = { ...DEFAULT_CORS, ...config };
    assertSafe(merged);
    compiled = { origins: compileOrigins(merged) };
    compiledForConfig.set(config, compiled);
  }
  return compiled;
}

/**
 * Whether `origin` may call the API under `config` (default: the bound config). Returns the value
 * for `Access-Control-Allow-Origin` (`"*"` for a plain wildcard) or `null`.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  request?: Request,
  config?: CorsConfig,
): string | null {
  const compiled = config ? compileFor(config) : compileFor(corsConfig);
  return originAllowed(origin ?? null, compiled.origins, request);
}

function headerList(values: string[] | undefined, requestHeader: string | null): string {
  const list = values ?? ["*"];
  if (list.length === 1 && list[0] === "*") {
    return requestHeader && requestHeader.length > 0 ? requestHeader : "*";
  }
  return list.join(", ");
}

/** Add `Vary: Origin` without dropping what is already there. */
function addVary(headers: Headers): void {
  const current = headers.get("Vary");
  if (current === null) {
    headers.set("Vary", "Origin");
  } else if (current.trim() !== "*" && !/(^|,)\s*origin\s*(,|$)/i.test(current)) {
    headers.set("Vary", `${current}, Origin`);
  }
}

function applyAllowHeaders(
  headers: Headers,
  request: Request,
  cfg: CorsConfig,
  allowOrigin: string,
  varies: boolean,
): void {
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  if (cfg.supports_credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (varies) addVary(headers);
  const exposed = cfg.exposed_headers ?? [];
  if (exposed.length > 0) {
    headers.set("Access-Control-Expose-Headers", exposed.join(", "));
  }
  // For preflight we also set allow methods/headers; for normal responses origin is enough.
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set(
      "Access-Control-Allow-Methods",
      headerList(cfg.allowed_methods, null).replace("*", "GET, HEAD, PUT, PATCH, POST, DELETE"),
    );
    headers.set(
      "Access-Control-Allow-Headers",
      headerList(cfg.allowed_headers, request.header("access-control-request-headers")),
    );
    const maxAge = cfg.max_age ?? DEFAULT_CORS.max_age;
    if (maxAge > 0) {
      headers.set("Access-Control-Max-Age", String(maxAge));
    }
    if (
      cfg.allow_private_network &&
      (request.header("access-control-request-private-network") ?? "")
        .split(",")
        .some((value) => value.trim() === "true")
    ) {
      headers.set("Access-Control-Allow-Private-Network", "true");
    }
  }
}

type CompiledCors = {
  version: number;
  cfg: CorsConfig;
  /** No path is covered. */
  none: boolean;
  /** `*` covers every path. */
  all: boolean;
  exact: Set<string>;
  /** `prefix/*` patterns, without the slashes. */
  prefixes: string[];
  origins: CompiledOrigins;
};

/** The merged config and its path patterns, built once per config version instead of once per request. */
function compileCors(config: CorsConfig | undefined): CompiledCors {
  const cfg = { ...DEFAULT_CORS, ...corsConfig, ...(config ?? {}) };
  assertSafe(cfg);
  const paths = cfg.paths ?? [];
  const exact = new Set<string>();
  const prefixes: string[] = [];
  let all = false;
  for (const pattern of paths) {
    if (pattern === "*") all = true;
    else if (pattern.endsWith("/*")) prefixes.push(pattern.slice(0, -2).replace(/^\//, ""));
    else exact.add(pattern.replace(/^\//, ""));
  }
  return {
    version: corsVersion,
    cfg,
    none: paths.length === 0,
    all,
    exact,
    prefixes,
    origins: compileOrigins(cfg),
  };
}

function coversPath(compiled: CompiledCors, path: string): boolean {
  if (compiled.all) return true;
  const normalized = path.charCodeAt(0) === 47 ? path.slice(1) : path;
  if (compiled.exact.has(normalized)) return true;
  for (const prefix of compiled.prefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** Whether a route's URL can match a CORS path. `{param}` segments could be anything, so they match. */
function routeMayMatch(compiled: CompiledCors, uri: string): boolean {
  if (compiled.none) return false;
  if (compiled.all) return true;
  const segments = uri.split("/").filter(Boolean);
  const isParam = (segment: string | undefined) => segment !== undefined && segment.startsWith("{");
  const same = (pattern: string, count: number) => {
    const wanted = pattern.split("/").filter(Boolean);
    if (wanted.length > segments.length || (count >= 0 && wanted.length !== count)) return false;
    return wanted.every((part, i) => isParam(segments[i]) || segments[i] === part);
  };
  for (const exact of compiled.exact) if (same(exact, segments.length)) return true;
  for (const prefix of compiled.prefixes) if (same(prefix, -1)) return true;
  return false;
}

/**
 * Global CORS middleware.
 * Answers OPTIONS preflight when the path matches `config/cors.ts` paths. A request outside those paths
 * passes straight through with no work beyond the path test.
 */
export function handleCors(config?: CorsConfig): Middleware {
  let compiled = compileCors(config);

  return {
    alias: "cors",
    appliesTo(route: { uri: string }): boolean {
      if (compiled.version !== corsVersion) compiled = compileCors(config);
      return routeMayMatch(compiled, route.uri);
    },
    handle(request: Request, next: Next): Promise<Response> | Response {
      if (compiled.version !== corsVersion) compiled = compileCors(config);
      if (compiled.none || !coversPath(compiled, request.path())) return next();
      return cors(request, next, compiled);
    },
  };
}

async function cors(request: Request, next: Next, compiled: CompiledCors): Promise<Response> {
  if (request.method.toUpperCase() === "OPTIONS") {
    return answerPreflight(request, compiled);
  }
  return decorate(request, await next(), compiled);
}

function answerPreflight(request: Request, compiled: CompiledCors): Response {
  const allowOrigin = originAllowed(request.header("origin"), compiled.origins, request);
  if (!allowOrigin) {
    const denied = new Response(null, { status: 403 });
    if (compiled.origins.varies) addVary(denied.headers);
    return denied;
  }
  const response = new Response(null, { status: 204 });
  applyAllowHeaders(response.headers, request, compiled.cfg, allowOrigin, compiled.origins.varies);
  return response;
}

function decorate(request: Request, response: Response, compiled: CompiledCors): Response {
  const allowOrigin = originAllowed(request.header("origin"), compiled.origins, request);
  const { varies } = compiled.origins;
  if (!allowOrigin) {
    // No CORS headers, but a shared cache must still key this answer on the origin.
    return varies ? withHeaders(response, addVary) : response;
  }
  return withHeaders(response, (headers) =>
    applyAllowHeaders(headers, request, compiled.cfg, allowOrigin, varies),
  );
}

/**
 * Add CORS headers to a response built outside the middleware stack (a static file, a share page).
 * Uses `config` when given, else the bound config. The request's path is not checked.
 */
export function applyCors(
  request: Request | globalThis.Request,
  response: Response,
  config?: CorsConfig,
): Response {
  return decorate(asRequest(request), response, programmatic(config));
}

/** The answer to an OPTIONS preflight, for code that handles requests before the kernel does. */
export function corsPreflight(
  request: Request | globalThis.Request,
  config?: CorsConfig,
): Response {
  return answerPreflight(asRequest(request), programmatic(config));
}

/** The framework request, wrapping a plain fetch `Request` when that is what the caller has. */
function asRequest(request: Request | globalThis.Request): Request {
  return request instanceof globalThis.Request ? new BunyadRequest(request) : request;
}

const programmaticByConfig = new WeakMap<CorsConfig, CompiledCors>();

function programmatic(config?: CorsConfig): CompiledCors {
  const base = config ?? corsConfig;
  const cached = programmaticByConfig.get(base);
  if (cached && (config !== undefined || cached.version === corsVersion)) return cached;
  const compiled = compileCors(config);
  programmaticByConfig.set(base, compiled);
  return compiled;
}
