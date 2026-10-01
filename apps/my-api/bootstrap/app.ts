import { Application, resolveAppBasePath, setApplicationInstance } from "@bunyad/core";
import { bootFrameworkProviders } from "@bunyad/framework";
import { json } from "@bunyad/http";
import { Router, loadRouteModule } from "@bunyad/router";
import appConfig from "../config/app.ts";
import { registerMiddleware } from "./middleware.ts";
import { registerProviders } from "./providers.ts";

/**
 * `options.router` is the router `bunyad compile` builds (`.build/server.ts`), with
 * the routes already registered; without it, the route files load from source.
 */
export async function createApplication(options: { router?: Router } = {}) {
  const basePath = resolveAppBasePath(import.meta.dir);
  const compiled = options.router;
  const router = compiled ?? new Router();
  const app = new Application({
    basePath,
    config: { app: appConfig },
    router,
  });

  await bootFrameworkProviders(app, {
    except: ["view", "session", "live", "head", "inertia"],
  });
  registerProviders(app);
  registerMiddleware(app);
  if (!compiled) await loadRouteModule(app.basePath("routes/api.ts"), app.router);
  app.router.get("/", () => json({ name: appConfig.name }));
  setApplicationInstance(app);
  await app.boot();
  return app;
}
