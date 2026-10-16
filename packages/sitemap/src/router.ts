/**
 * `@bunyad/sitemap/router` — route source (T2.2). Absolute URLs come from the
 * named-route generator inside `Url.withRoot(baseUrl)`, never from APP_URL.
 */
import {
  Url as UrlGenerator,
  getActiveRouter,
  type RouteDefinition,
  type RouteParamValue,
  type Router,
} from "@bunyad/router";
import { middlewareAliasOf } from "@bunyad/http";
import { Url } from "./url.ts";

type ParamSets =
  | Iterable<Record<string, RouteParamValue>>
  | AsyncIterable<Record<string, RouteParamValue>>;

export type FromRoutesOptions = {
  router?: Router;
  /** Route names or `*` globs to include (default: every eligible route). */
  only?: string[];
  /** Route names or `*` globs to exclude. */
  except?: string[];
  /** Parameter sets per route name; routes with params are skipped unless listed here. */
  params?: Record<string, () => ParamSets>;
  /** Only routes without a domain or with this host's domain (D7). */
  host?: string;
  /** Middleware names that exclude a route (default `auth`, `auth:*`, `guest`, `signed`, `verified`). */
  excludeMiddleware?: string[];
};

const DEFAULT_EXCLUDED = [
  "auth",
  "auth:*",
  "guest",
  "signed",
  "signed:*",
  "verified",
];

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

function middlewareNames(route: RouteDefinition): string[] {
  const names: string[] = [];
  for (const m of route.middleware) {
    const alias = middlewareAliasOf(m);
    if (alias) names.push(alias);
  }
  return names;
}

/** Eligible routes: GET, named, not excluded, no params unless `params[name]` is given. */
export function sitemapRoutes(
  options: FromRoutesOptions = {},
): RouteDefinition[] {
  const router = options.router ?? getActiveRouter();
  const only = (options.only ?? []).map(globToRegExp);
  const except = (options.except ?? []).map(globToRegExp);
  const excluded = (options.excludeMiddleware ?? DEFAULT_EXCLUDED).map(
    globToRegExp,
  );
  const host = options.host?.toLowerCase();
  return router.getRoutes().filter((route) => {
    const name = route.name;
    if (!name || !route.methods.includes("GET")) return false;
    if (only.length > 0 && !matchesAny(name, only)) return false;
    if (matchesAny(name, except)) return false;
    if (route.paramNames.length > 0 && !options.params?.[name]) return false;
    if (middlewareNames(route).some((m) => matchesAny(m, excluded)))
      return false;
    if (route.domain) {
      if (route.domain.includes("{")) return false;
      if (host !== undefined && route.domain.toLowerCase() !== host)
        return false;
    }
    return true;
  });
}

/**
 * `Sitemap.create().add(fromRoutes({ only: ["home", "posts.*"] }))`. URLs are
 * absolute via `router.route(name, params, true)`; run inside `withRoot` (or
 * `generateSitemaps` with `routerScope`) to pin the base URL per domain.
 */
export async function* fromRoutes(
  options: FromRoutesOptions = {},
): AsyncGenerator<Url> {
  const router = options.router ?? getActiveRouter();
  for (const route of sitemapRoutes(options)) {
    const name = route.name as string;
    const sets = options.params?.[name];
    if (!sets) {
      yield Url.create(router.route(name, {}, true));
      continue;
    }
    for await (const params of sets())
      yield Url.create(router.route(name, params, true));
  }
}

/** `generateSitemaps(config, { scope: routerScope })`: builds run inside `Url.withRoot(baseUrl)`. */
export function routerScope<T>(
  baseUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  return UrlGenerator.withRoot(baseUrl, fn);
}

export { routerScope as withRoot };
