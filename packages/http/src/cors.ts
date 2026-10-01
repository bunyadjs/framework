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

/** Bound by HttpServiceProvider from `config/cors.ts`. */
export function setCorsConfig(config: CorsConfig | undefined): void {
  corsConfig = { ...DEFAULT_CORS, ...(config ?? {}) };
}

export function getCorsConfig(): CorsConfig {
  return corsConfig;
}

function pathMatches(pattern: string, path: string): boolean {
  const normalized = path.replace(/^\//, "");
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2).replace(/^\//, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  return normalized === pattern.replace(/^\//, "");
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

/**
 * Global CORS middleware (Laravel `HandleCors`).
 * Answers OPTIONS preflight when the path matches `config/cors.ts` paths.
 */
export function handleCors(config?: CorsConfig): Middleware {
  const resolved = () => ({ ...DEFAULT_CORS, ...corsConfig, ...(config ?? {}) });

  return {
    alias: "cors",
    async handle(request: Request, next: Next): Promise<Response> {
      const cfg = resolved();
      const path = request.path();
      const paths = cfg.paths ?? [];
      if (paths.length === 0 || !paths.some((pattern) => pathMatches(pattern, path))) {
        return next();
      }

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
    },
  };
}
