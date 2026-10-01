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
