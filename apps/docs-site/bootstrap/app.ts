import {
  Application,
  resolveAppBasePath,
  setApplicationInstance,
} from "@bunyad/core";
import { Router, loadRouteModule } from "@bunyad/router";
import appConfig from "../config/app.ts";

/** Minimal application: router and HTTP kernel only. */
export async function createApplication() {
  const basePath = resolveAppBasePath(import.meta.dir);
  const router = new Router();
  const app = new Application({
    basePath,
    config: { app: appConfig },
    router,
  });

  await loadRouteModule(app.basePath("routes/web.ts"), app.router);
  setApplicationInstance(app);
  await app.boot();
  return app;
}
