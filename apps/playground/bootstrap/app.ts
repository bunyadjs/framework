import { Application, resolveAppBasePath, setApplicationInstance } from "@bunyad/core";
import { bootFrameworkProviders } from "@bunyad/framework";
import "@bunyad/framework/globals";
import { Router, loadRouteModule, type Router as RouterType } from "@bunyad/router";
import appConfig from "../config/app.ts";
import { registerMiddleware } from "./middleware.ts";
import { registerProviders } from "./providers.ts";

export type CreateApplicationOptions = {
  /** The router `bunyad compile` builds, with the routes already registered. */
  router?: RouterType;
  /** When true, skip loading routes/web.ts (tests that inject a custom router). */
  skipRoutes?: boolean;
};

/**
 * Thin bootstrap — Application shell, framework providers, then app providers.
 * Routes load Laravel-style via side-effect `Route.*` in `routes/web.ts`
 * (Route façade forwards to this app router while loading).
 */
export async function createApplication(
  options: CreateApplicationOptions = {},
) {
  const basePath = resolveAppBasePath(import.meta.dir);
  const router = options.router ?? new Router();

  const app = new Application({
    basePath,
    config: { app: appConfig },
    router,
  });

  await bootFrameworkProviders(app);
  registerProviders(app);
  registerMiddleware(app);
  if (!options.router && !options.skipRoutes) {
    await loadRouteModule(app.basePath("routes/web.ts"), app.router);
  }
  setApplicationInstance(app);
  await app.boot();
  return app;
}
