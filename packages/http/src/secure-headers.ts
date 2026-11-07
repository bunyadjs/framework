import type { Middleware, Next } from "./pipeline.ts";
import { Request as BunyadRequest, type Request } from "./request.ts";
import { withHeaders } from "./response-headers.ts";

export type SecureHeadersConfig = {
  /**
   * `"web"` (default): pages. `"api"`: JSON endpoints, which also send a `Content-Security-Policy`
   * that forbids everything, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
   * Any other setting here overrides the preset.
   */
  preset?: "web" | "api";
  /** `X-Content-Type-Options: nosniff`. Default on. */
  contentTypeOptions?: boolean;
  /** `Referrer-Policy` value, or `false` for none. Default `strict-origin-when-cross-origin`. */
  referrerPolicy?: string | false;
  /** `X-Frame-Options` value, or `false` for none. Default `SAMEORIGIN`. */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  /**
   * `Strict-Transport-Security`, sent over https only (including https reached through a trusted
   * proxy). Default `max-age=15552000` (180 days); `false` for none.
   */
  hsts?: { maxAge?: number; includeSubDomains?: boolean; preload?: boolean } | false;
  /** `Content-Security-Policy` value. No default for pages: it depends on what they load. */
  contentSecurityPolicy?: string | false;
  /** `Permissions-Policy` value. No default. */
  permissionsPolicy?: string | false;
};

type Compiled = {
  /** Headers sent on every response. */
  always: Array<[string, string]>;
  /** Sent only when the request arrived over https. */
  https: Array<[string, string]>;
};

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** Build the header lists once, so a request only copies them. */
function compile(config: SecureHeadersConfig = {}): Compiled {
  const api = config.preset === "api";
  const always: Array<[string, string]> = [];
  if (config.contentTypeOptions !== false) always.push(["X-Content-Type-Options", "nosniff"]);
  const referrer = config.referrerPolicy ?? (api ? "no-referrer" : "strict-origin-when-cross-origin");
  if (referrer !== false) always.push(["Referrer-Policy", referrer]);
  const frame = config.frameOptions ?? (api ? "DENY" : "SAMEORIGIN");
  if (frame !== false) always.push(["X-Frame-Options", frame]);
  const csp = config.contentSecurityPolicy ?? (api ? API_CSP : false);
  if (csp !== false) always.push(["Content-Security-Policy", csp]);
  if (config.permissionsPolicy) always.push(["Permissions-Policy", config.permissionsPolicy]);

  const https: Array<[string, string]> = [];
  if (config.hsts !== false) {
    const hsts = config.hsts ?? {};
    let value = `max-age=${hsts.maxAge ?? 15_552_000}`;
    if (hsts.includeSubDomains) value += "; includeSubDomains";
    if (hsts.preload) value += "; preload";
    https.push(["Strict-Transport-Security", value]);
  }
  return { always, https };
}

function decorate(request: Request, response: Response, compiled: Compiled): Response {
  const secure = compiled.https.length > 0 && request.secure();
  return withHeaders(response, (headers) => {
    for (const [name, value] of compiled.always) if (!headers.has(name)) headers.set(name, value);
    if (secure) for (const [name, value] of compiled.https) if (!headers.has(name)) headers.set(name, value);
  });
}

/**
 * Security headers on every response. Headers a handler sets itself are kept. The headers are built
 * once when the middleware is made; a request costs a few `Headers.set` calls and no response copy.
 */
export function secureHeaders(config?: SecureHeadersConfig): Middleware {
  const compiled = compile(config);
  return {
    alias: "secure-headers",
    handle(request: Request, next: Next): Promise<Response> | Response {
      const result = next();
      return result instanceof Promise ? result.then((response) => decorate(request, response, compiled)) : decorate(request, result, compiled);
    },
  };
}

const programmatic = new WeakMap<SecureHeadersConfig, Compiled>();
const defaults = compile();

/**
 * Add the security headers to a response built outside the middleware stack (a static file, a
 * share page). Takes a plain fetch `Request` or a framework one.
 */
export function applySecureHeaders(
  request: Request | globalThis.Request,
  response: Response,
  config?: SecureHeadersConfig,
): Response {
  let compiled = defaults;
  if (config) {
    compiled = programmatic.get(config) ?? compile(config);
    programmatic.set(config, compiled);
  }
  const framework = request instanceof globalThis.Request ? new BunyadRequest(request) : request;
  return decorate(framework, response, compiled);
}
