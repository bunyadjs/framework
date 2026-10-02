import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getActiveRouter,
  setActiveRouter,
  type Router,
} from "./router.ts";
import { applyRouteFileBindings } from "./route-bindings.ts";

export type LoadedRouteStyle = "default" | "registerRoutes" | "side-effect";

export type RouteModule = {
  default?: ((router: Router) => void | Promise<void>) | unknown;
  registerRoutes?: (router: Router) => void | Promise<void>;
  /** @deprecated Invented per-file names (e.g. registerWebRoutes) are rejected. */
  registerWebRoutes?: unknown;
  registerApiRoutes?: unknown;
};

export type LoadRouteModuleOptions = {
  /**
   * When the file is `routes/api.ts`, apply the `api` middleware group and
   * this URI prefix (default `"api"`). Pass `false` to skip (routes as written).
   */
  apiPrefix?: string | false;
};

function toImportUrl(entry: string): string {
  if (entry.startsWith("file:")) return entry;
  return pathToFileURL(entry).href;
}

function toFilePath(entry: string): string {
  if (entry.startsWith("file:")) return new URL(entry).pathname;
  return entry;
}

function isApiRouteFile(entry: string): boolean {
  return basename(toFilePath(entry)) === "api.ts";
}

/**
 * Load one route file onto `router`.
 *
 * Accepted styles (first match wins):
 * 1. `export default function (router: Router)` — preferred for apps/tests (reloadable)
 * 2. `export function registerRoutes(router)` — temporary BC
 * 3. Side-effect — top-level `Route.get(...)` / `Route` façade (fresh process OK)
 *
 * Web vs API is the **filename** (`routes/web.ts`, `routes/api.ts`), not the export name.
 * For `api.ts`, the `api` middleware group and `/api` prefix are applied unless
 * `apiPrefix: false` is passed.
 *
 * After registration, scans the file once for typed closure params and stamps
 * model binders + inject plans (boot-time only).
 */
export async function loadRouteModule(
  entry: string,
  router: Router = getActiveRouter(),
  options: LoadRouteModuleOptions = {},
): Promise<LoadedRouteStyle> {
  setActiveRouter(router);
  // Bust module cache so side-effect Route.* files re-register after Route.clear()
  // (compile / route:list / tests in the same process).
  const base = toImportUrl(entry);
  const href = `${base}${base.includes("?") ? "&" : "?"}bunyadLoad=${Date.now()}`;
  const mod = (await import(href)) as RouteModule;

  if (typeof mod.registerWebRoutes === "function" || typeof mod.registerApiRoutes === "function") {
    throw new Error(
      `Route file must not export registerWebRoutes/registerApiRoutes (${entry}). ` +
        `Use top-level Route.* side effects, export default function (router), or registerRoutes (BC). ` +
        `Web vs api is the filename (routes/web.ts, routes/api.ts).`,
    );
  }

  const register = async (): Promise<LoadedRouteStyle> => {
    if (typeof mod.default === "function") {
      await (mod.default as (router: Router) => void | Promise<void>)(router);
      return "default";
    }
    if (typeof mod.registerRoutes === "function") {
      await mod.registerRoutes(router);
      return "registerRoutes";
    }
    // Side-effect: top-level Route.* ran during import; Route façade forwards to `router`
    // because setActiveRouter(router) ran above.
    return "side-effect";
  };

  // Apply for routes/api.ts by default, or whenever a string apiPrefix is passed
  // (Application.configure().withRouting({ api }) always passes a string).
  const applyApi =
    options.apiPrefix !== false &&
    (isApiRouteFile(entry) || typeof options.apiPrefix === "string");
  const apiPrefix =
    typeof options.apiPrefix === "string" ? options.apiPrefix : "api";

  let style: LoadedRouteStyle;
  if (applyApi) {
    let resolved!: LoadedRouteStyle;
    await router.middleware("api").prefix(apiPrefix).group(async () => {
      resolved = await register();
    });
    style = resolved;
  } else {
    style = await register();
  }

  await applyRouteFileBindings(router, toFilePath(entry));
  return style;
}

/**
 * Load `routes/web.ts` and/or `routes/api.ts` when present (order: web, then api).
 */
export async function loadRouteFiles(
  paths: string[],
  router: Router = getActiveRouter(),
  options: LoadRouteModuleOptions = {},
): Promise<LoadedRouteStyle[]> {
  const styles: LoadedRouteStyle[] = [];
  for (const path of paths) {
    styles.push(await loadRouteModule(path, router, options));
  }
  return styles;
}
