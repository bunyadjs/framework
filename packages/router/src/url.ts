import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "@bunyad/http";
import {
  abort,
  aliasMiddleware,
  setRedirectFlashAccessor,
  setRedirectUrlGenerator,
  setSignatureChecker,
  taggedMiddleware,
} from "@bunyad/http";
import { resolveControllerAction, Route, route as namedRoute } from "./router.ts";
import {
  flushUrlContext,
  getUrlContext,
  getUrlDefaults,
  normalizeRouteParams,
  runWithUrlContext,
  setUrlDefaults,
  setUrlRequest,
  type RouteParamValue,
  type UrlDefaults,
} from "./context.ts";
import { formatPathWithParams, mergeQuery } from "./query.ts";

let appKey: string | undefined = process.env.APP_KEY || undefined;

function isProduction(): boolean {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}

function resolveUrlKey(): string {
  if (appKey && appKey.length > 0) return appKey;
  const fromEnv = process.env.APP_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (isProduction()) {
    throw new Error(
      "APP_KEY is not set. Call Url.setKey() or set APP_KEY before signing URLs in production.",
    );
  }
  // Dev/test only — never used when APP_ENV/NODE_ENV is production.
  return "bunyad-insecure-dev-key-do-not-use-in-production";
}
let rootUrl = (process.env.APP_URL ?? "http://localhost").replace(/\/$/, "");
let assetRoot =
  (process.env.ASSET_URL ?? process.env.APP_URL ?? "http://localhost").replace(
    /\/$/,
    "",
  );
let forcedScheme: string | null = null;

function hmac(payload: string): string {
  return createHmac("sha256", resolveUrlKey()).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Build path+query for signing (no `signature` param). */
function signaturePayload(pathWithQuery: string): string {
  const url = new URL(pathWithQuery, "http://signature.local");
  url.searchParams.delete("signature");
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function expirationSeconds(expiration: Date | number): number {
  if (expiration instanceof Date) {
    return Math.floor(expiration.getTime() / 1000);
  }
  if (expiration > 1_000_000_000) return Math.floor(expiration);
  return Math.floor(Date.now() / 1000) + Math.floor(expiration * 60);
}

function requestFromContext(): Request | undefined {
  return getUrlContext().request;
}

function originOf(requestUrl: string): string {
  const u = new URL(requestUrl);
  return u.origin;
}

/**
 * URL generator / facade — path helpers, current request URL, signed routes.
 */
export type UrlFacade = {
  setKey(key: string): void;
  setRoot(url: string): void;
  forceRootUrl(url: string): void;
  forceScheme(scheme: string | null): void;
  forceHttps(): void;
  defaults(values: UrlDefaults): void;
  getDefault(key: string): string | number | undefined;
  getDefaults(): UrlDefaults;
  to(path: string): string;
  query(path: string, parameters?: Record<string, unknown>): string;
  asset(path: string, secure?: boolean | null): string;
  assetFrom(root: string, path: string, secure?: boolean | null): string;
  secure(path: string): string;
  isValidUrl(url: string): boolean;
  current(): string;
  full(): string;
  previous(fallback?: string): string;
  previousPath(fallback?: string): string;
  route(
    name: string,
    params?: Record<string, RouteParamValue>,
    absolute?: boolean,
  ): string;
  toRoute(name: string, params?: Record<string, RouteParamValue>): string;
  action(
    target: [new () => object, string] | (new () => object),
    params?: Record<string, RouteParamValue>,
    absolute?: boolean,
  ): string;
  signedRoute(
    name: string,
    params?: Record<string, RouteParamValue>,
    absolute?: boolean,
  ): string;
  temporarySignedRoute(
    name: string,
    expiration: Date | number,
    params?: Record<string, RouteParamValue>,
    absolute?: boolean,
  ): string;
  hasValidSignature(request: Request, absolute?: boolean): boolean;
  hasValidSignatureWhileIgnoring(
    request: Request,
    ignore: string[],
    absolute?: boolean,
  ): boolean;
  format(path: string, absolute?: boolean): string;
};

export const Url: UrlFacade = {
  setKey(key) {
    appKey = key;
  },

  setRoot(url) {
    rootUrl = url.replace(/\/$/, "");
  },

  forceRootUrl(url) {
    Url.setRoot(url);
  },

  forceScheme(scheme) {
    forcedScheme = scheme;
  },

  forceHttps() {
    forcedScheme = "https";
  },

  defaults(values) {
    setUrlDefaults(values);
  },

  getDefault(key) {
    return getUrlDefaults()[key];
  },

  getDefaults() {
    return getUrlDefaults();
  },

  /** Absolute URL for a path (uses current request origin when available). */
  to(path) {
    return applyForcedScheme(Url.format(path, true));
  },

  /** Absolute URL with merged query parameters. */
  query(path, parameters = {}) {
    const absolutePath = /^https?:\/\//i.test(path) ? path : Url.to(path);
    return mergeQuery(absolutePath, parameters, rootUrl);
  },

  asset(path, secure = null) {
    return Url.assetFrom(assetRoot, path, secure);
  },

  assetFrom(root, path, secure = null) {
    const base = root.replace(/\/$/, "");
    const normalized = path.startsWith("/") ? path : `/${path}`;
    let url = /^https?:\/\//i.test(path) ? path : `${base}${normalized}`;
    if (secure === true) {
      url = url.replace(/^http:/i, "https:");
    } else if (secure === false) {
      url = url.replace(/^https:/i, "http:");
    } else {
      url = applyForcedScheme(url);
    }
    return url;
  },

  secure(path) {
    return Url.to(path).replace(/^http:/i, "https:");
  },

  isValidUrl(value) {
    try {
      // Absolute URLs only (scheme required).
      const u = new URL(value);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  },

  /** Current URL without query string. */
  current() {
    const request = requestFromContext();
    if (!request) return rootUrl;
    const u = new URL(request.url);
    return `${u.origin}${u.pathname}`;
  },

  /** Current URL including query string. */
  full() {
    const request = requestFromContext();
    if (!request) return rootUrl;
    return request.url;
  },

  /** Previous URL (session `_previous.url`, then Referer). */
  previous(fallback = "/") {
    const request = requestFromContext();
    const fromSession = request?.session?.get<string>("_previous.url");
    if (fromSession) return fromSession;
    const referer = request?.header("referer") ?? request?.header("referrer");
    if (referer) return referer;
    if (fallback.startsWith("http")) return fallback;
    return Url.to(fallback);
  },

  previousPath(fallback = "/") {
    try {
      return new URL(Url.previous(fallback)).pathname;
    } catch {
      return fallback.startsWith("/") ? fallback : `/${fallback}`;
    }
  },

  route(name, params = {}, absolute = false) {
    return namedRoute(name, params, absolute);
  },

  toRoute(name, params = {}) {
    return namedRoute(name, params, true);
  },

  action(target, params = {}, absolute = true) {
    return action(target, params, absolute);
  },

  signedRoute(name, params = {}, absolute = true) {
    const path = namedRoute(name, params, false);
    const payload = signaturePayload(path);
    const signature = hmac(payload);
    const sep = path.includes("?") ? "&" : "?";
    const relative = `${path}${sep}signature=${signature}`;
    return absolute ? `${rootForAbsolute()}${relative}` : relative;
  },

  temporarySignedRoute(name, expiration, params = {}, absolute = true) {
    const path = namedRoute(name, params, false);
    const expires = expirationSeconds(expiration);
    const withExpires = path.includes("?")
      ? `${path}&expires=${expires}`
      : `${path}?expires=${expires}`;
    const payload = signaturePayload(withExpires);
    const signature = hmac(payload);
    const relative = `${withExpires}&signature=${signature}`;
    return absolute ? `${rootForAbsolute()}${relative}` : relative;
  },

  hasValidSignature(request, absolute = false) {
    return Url.hasValidSignatureWhileIgnoring(request, [], absolute);
  },

  hasValidSignatureWhileIgnoring(request, ignore, absolute = false) {
    const url = new URL(request.url);
    const signature = url.searchParams.get("signature");
    if (!signature) return false;

    const expires = url.searchParams.get("expires");
    if (expires !== null) {
      const exp = Number(expires);
      if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
        return false;
      }
    }

    const clone = new URL(request.url);
    for (const key of ignore) {
      clone.searchParams.delete(key);
      for (const existing of [...clone.searchParams.keys()]) {
        if (existing.startsWith(`${key}[`)) clone.searchParams.delete(existing);
      }
    }

    const pathWithQuery = absolute
      ? `${clone.origin}${clone.pathname}${clone.search}`
      : `${clone.pathname}${clone.search}`;
    const expected = hmac(signaturePayload(pathWithQuery));
    return safeEqualHex(signature, expected);
  },

  format(path, absolute = true) {
    if (/^https?:\/\//i.test(path)) return applyForcedScheme(path);
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (!absolute) return normalized;
    return applyForcedScheme(`${rootForAbsolute()}${normalized}`);
  },
};

function applyForcedScheme(url: string): string {
  if (!forcedScheme || !/^https?:\/\//i.test(url)) return url;
  return url.replace(/^https?:/i, `${forcedScheme}:`);
}

function rootForAbsolute(): string {
  const request = requestFromContext();
  if (request) return originOf(request.url);
  return rootUrl;
}

/**
 * `url('/path')` or `url()` for the generator (`url().current()`, `url().query(...)`).
 */
export function url(): UrlFacade;
export function url(path: string): string;
export function url(path?: string): string | UrlFacade {
  if (path === undefined) return Url;
  return Url.to(path);
}

/** Public asset URL (`/css/app.css` → absolute under ASSET_URL / APP_URL). */
export function asset(path: string, secure?: boolean | null): string {
  return Url.asset(path, secure);
}

/**
 * URL for `[Controller, 'method']` or an invokable controller (`__invoke`).
 */
export function action(
  target: [new () => object, string] | (new () => object),
  params: Record<string, RouteParamValue> = {},
  absolute = true,
): string {
  const [ctor, method] = Array.isArray(target)
    ? target
    : resolveControllerAction(target);

  for (const definition of Route.routes) {
    const act = definition.action;
    if (!Array.isArray(act)) continue;
    if (act[0] !== ctor || act[1] !== method) continue;
    const merged = normalizeRouteParams({
      ...getUrlDefaults(),
      ...params,
    });
    const path = formatPathWithParams(definition.uri, merged);
    return absolute ? Url.format(path, true) : path;
  }

  const label = `${ctor.name}@${method}`;
  throw new Error(`Action ${label} not defined.`);
}

setSignatureChecker((request, absolute, ignore = []) =>
  Url.hasValidSignatureWhileIgnoring(request, ignore, absolute),
);

/**
 * Bind the current request for `url()->current()` / `previous()` / absolute hosts.
 */
export function handleUrl() {
  return {
    async handle(
      request: Request,
      next: () => Promise<Response> | Response,
    ): Promise<Response> {
      return runWithUrlContext(async () => {
        setUrlRequest(request);
        const response = await next();
        if (request.session && request.method === "GET") {
          const accept = request.header("accept") ?? "";
          // Only HTML navigations — skip JSON clients and load generators (`*/*`).
          if (accept.includes("text/html")) {
            const previous = request.session.get<string>("_previous.url");
            if (previous !== request.url) {
              request.session.put("_previous.url", request.url);
            }
          }
        }
        return response;
      }, { request });
    },
  };
}

/**
 * `signed` middleware — abort 403 when the signature is invalid.
 */
export function signed(options: { absolute?: boolean } = {}) {
  const absolute = options.absolute ?? false;
  return taggedMiddleware(
    absolute ? "signed:absolute" : "signed",
    {
      async handle(request: Request, next: () => Promise<Response> | Response) {
        if (!Url.hasValidSignature(request, absolute)) {
          abort(403, "Invalid signature.");
        }
        return next();
      },
    },
  );
}

aliasMiddleware("signed", (...params: string[]) => {
  return signed({ absolute: params[0] === "absolute" });
});

export { flushUrlContext, runWithUrlContext, setUrlRequest };

/** Keep Route linked for named lookups. */
void Route;

// Live fluent `redirect()->back()` / `redirect()->route()` to this URL generator.
setRedirectUrlGenerator({
  to: (path) => {
    // Path-absolute Location headers stay relative (Laravel default for `/…`).
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/")) return path;
    return Url.to(path);
  },
  previous: (fallback) => Url.previous(fallback),
  current: () => Url.current(),
  route: (name, params, absolute) =>
    namedRoute(
      name,
      params as Record<string, RouteParamValue>,
      absolute ?? false,
    ),
  action: (target, params, absolute) =>
    action(target, params as Record<string, RouteParamValue>, absolute ?? true),
});

setRedirectFlashAccessor(
  () => getUrlContext().request?.session,
  () => {
    const request = getUrlContext().request;
    if (!request || typeof request.all !== "function") return undefined;
    return { all: () => request.all() as Record<string, unknown> };
  },
);
