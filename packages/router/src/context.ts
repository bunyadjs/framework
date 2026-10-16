import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "@bunyad/http";

export type RouteParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { getRouteKey(): string | number }
  | { id: string | number };

export type UrlDefaults = Record<string, string | number>;

type UrlContext = {
  request?: Request;
  defaults: UrlDefaults;
};

const storage = new AsyncLocalStorage<UrlContext>();

function emptyContext(): UrlContext {
  return { defaults: {} };
}

/** Fallback when not inside `runWithUrlContext`. */
let fallback: UrlContext = emptyContext();

export function getUrlContext(): UrlContext {
  return storage.getStore() ?? fallback;
}

export function runWithUrlContext<T>(
  fn: () => T,
  options: { request?: Request; defaults?: UrlDefaults } = {},
): T {
  return storage.run(
    {
      request: options.request,
      defaults: { ...(options.defaults ?? {}) },
    },
    fn,
  );
}

export function setUrlRequest(request: Request | undefined): void {
  getUrlContext().request = request;
}

export function getUrlDefaults(): UrlDefaults {
  return { ...getUrlContext().defaults };
}

export function setUrlDefaults(defaults: UrlDefaults): void {
  Object.assign(getUrlContext().defaults, defaults);
}

const rootStorage = new AsyncLocalStorage<string>();

/** Root set via `Url.setRoot()` / `forceRootUrl()`; `null` → `APP_URL`. */
let configuredRoot: string | null = null;

function trimRoot(url: string): string {
  return url.replace(/\/$/, "");
}

export function setConfiguredRoot(url: string): void {
  configuredRoot = trimRoot(url);
}

/** Root from the innermost `Url.withRoot()` scope, if any. */
export function getScopedRoot(): string | undefined {
  return rootStorage.getStore();
}

/** Run `fn` with an async-scoped absolute URL root (`Url.withRoot`). */
export function runWithRoot<T>(root: string, fn: () => T): T {
  return rootStorage.run(trimRoot(root), fn);
}

/**
 * Root used for absolute URLs when no request origin applies:
 * `withRoot` scope → `Url.setRoot()` → `APP_URL` → `http://localhost`.
 */
export function resolveRootUrl(): string {
  return (
    rootStorage.getStore() ??
    configuredRoot ??
    trimRoot(process.env.APP_URL ?? "http://localhost")
  );
}

export function flushUrlContext(): void {
  fallback = emptyContext();
}

/** Coerce route/model values to path segments. */
export function stringifyRouteParam(value: RouteParamValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if (
      "getRouteKey" in value &&
      typeof (value as { getRouteKey?: unknown }).getRouteKey === "function"
    ) {
      return String(
        (value as { getRouteKey: () => string | number }).getRouteKey(),
      );
    }
    if ("id" in value && value.id != null) return String(value.id);
  }
  return String(value);
}

/**
 * Flatten params for path substitution; leftover keys become query values.
 */
export function normalizeRouteParams(
  params: Record<string, RouteParamValue> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = stringifyRouteParam(value);
  }
  return out;
}
