import type { Request } from "./request.ts";
import type { Middleware, Next } from "./pipeline.ts";

export type CorsConfig = {
  /** Path patterns relative to the app root (`api/*`, `*`). Empty = no CORS. */
  paths?: string[];
  allowed_methods?: string[];
  allowed_origins?: string[];
  allowed_origins_patterns?: string[];
  allowed_headers?: string[];
  exposed_headers?: string[];
  max_age?: number;
  supports_credentials?: boolean;
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
  >
> = {
  paths: ["api/*", "auth/csrf-cookie"],
  allowed_methods: ["*"],
  allowed_origins: ["*"],
  allowed_origins_patterns: [],
  allowed_headers: ["*"],
  exposed_headers: [],
  max_age: 0,
  supports_credentials: false,
};

let corsConfig: CorsConfig = { ...DEFAULT_CORS };
/** Bumped whenever the bound config changes, so compiled matchers are rebuilt. */
let corsVersion = 0;

/** Bound by HttpServiceProvider from `config/cors.ts`. */
export function setCorsConfig(config: CorsConfig | undefined): void {
  corsConfig = { ...DEFAULT_CORS, ...(config ?? {}) };
  corsVersion++;
}

export function getCorsConfig(): CorsConfig {
  return corsConfig;
}

function originAllowed(origin: string | null, config: CorsConfig): string | null {
  if (!origin) return null;
  const origins = config.allowed_origins ?? DEFAULT_CORS.allowed_origins;
  if (origins.includes("*")) {
    return config.supports_credentials ? origin : "*";
  }
  if (origins.includes(origin)) return origin;
  for (const pattern of config.allowed_origins_patterns ?? []) {
    try {
      if (new RegExp(pattern).test(origin)) return origin;
    } catch {
      // ignore invalid patterns
    }
  }
  return null;
}

function headerList(values: string[] | undefined, requestHeader: string | null): string {
  const list = values ?? ["*"];
  if (list.length === 1 && list[0] === "*") {
    return requestHeader && requestHeader.length > 0 ? requestHeader : "*";
  }
  return list.join(", ");
}

function applyCorsHeaders(
  response: Response,
  request: Request,
  config: CorsConfig,
  allowOrigin: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  if (config.supports_credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (allowOrigin !== "*") {
    headers.append("Vary", "Origin");
  }
  const exposed = config.exposed_headers ?? [];
  if (exposed.length > 0) {
    headers.set("Access-Control-Expose-Headers", exposed.join(", "));
  }
  // For preflight we also set allow methods/headers; for normal responses origin is enough.
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set(
      "Access-Control-Allow-Methods",
      headerList(config.allowed_methods, null).replace("*", "GET, HEAD, PUT, PATCH, POST, DELETE"),
    );
    headers.set(
      "Access-Control-Allow-Headers",
      headerList(config.allowed_headers, request.header("access-control-request-headers")),
    );
    const maxAge = config.max_age ?? 0;
    if (maxAge > 0) {
      headers.set("Access-Control-Max-Age", String(maxAge));
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
};

/** The merged config and its path patterns, built once per config version instead of once per request. */
function compileCors(config: CorsConfig | undefined): CompiledCors {
  const cfg = { ...DEFAULT_CORS, ...corsConfig, ...(config ?? {}) };
  const paths = cfg.paths ?? [];
  const exact = new Set<string>();
  const prefixes: string[] = [];
  let all = false;
  for (const pattern of paths) {
    if (pattern === "*") all = true;
    else if (pattern.endsWith("/*")) prefixes.push(pattern.slice(0, -2).replace(/^\//, ""));
    else exact.add(pattern.replace(/^\//, ""));
  }
  return { version: corsVersion, cfg, none: paths.length === 0, all, exact, prefixes };
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
      return cors(request, next, compiled.cfg);
    },
  };
}

async function cors(request: Request, next: Next, cfg: CorsConfig): Promise<Response> {
  const origin = request.header("origin");
  const allowOrigin = originAllowed(origin, cfg);

  if (request.method.toUpperCase() === "OPTIONS") {
    if (!allowOrigin) {
      return new Response(null, { status: 403 });
    }
    return applyCorsHeaders(new Response(null, { status: 204 }), request, cfg, allowOrigin);
  }

  const response = await next();
  if (!allowOrigin) return response;
  return applyCorsHeaders(response, request, cfg, allowOrigin);
}
