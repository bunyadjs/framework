import { join } from "node:path";
import { Application, resolveAppRoot, serve, setApplicationInstance } from "@bunyad/core";
import { Router, loadRouteModule } from "@bunyad/router";
import { warm } from "@/Docs/cache.ts";
import appConfig from "./config/app.ts";

/** Minimal application: router and HTTP kernel only, with no framework providers. */
export async function createApplication() {
  const app = new Application({ basePath: resolveAppRoot(import.meta.dir), config: { app: appConfig }, router: new Router() });
  await loadRouteModule(app.basePath("routes"), app.router);
  setApplicationInstance(app);
  await app.boot();
  return app;
}

if (import.meta.main) {
  await warm();
  const app = await createApplication();
  serve(app, {
    refresh: ["content", "app", "routes", "public"].map((path) => join(import.meta.dir, path)),
  });
}
