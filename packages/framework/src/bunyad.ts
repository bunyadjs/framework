import { Application, resolveAppRoot, serve, setApplicationInstance, type ServeOptions, type ServiceProviderClass } from "@bunyad/core";
import type { Middleware } from "@bunyad/http";
import { Router, loadRouteModule } from "@bunyad/router";
import { registerErrorPages } from "./error-pages.ts";
import { loadTranslations } from "./translator.ts";
import { bootFrameworkProviders, type BootFrameworkOptions } from "./providers/index.ts";

export type BunyadOptions = BootFrameworkOptions & {
  /** Middleware groups, by name (`web`, `api`). A route tree is the `web` group unless a root `*.routes.ts` says otherwise. */
  groups?: Record<string, Middleware[]>;
  /** The app's own service providers. */
  providers?: ServiceProviderClass[];
  /** Global middleware: runs on every request, before the route's own. */
  middleware?: Middleware[];
  /** Options for `serve()` when the app serves itself, given the booted app (a custom `fetch`, a port). */
  serve?: (app: Application) => ServeOptions;
};

/** What `createApplication` takes: the router `bunyad compile` builds, with the routes already registered. */
export type CreateApplicationOptions = { router?: Router };

/**
 * An app in one line: `export const createApplication = bunyad(import.meta);`
 *
 * It finds `config/` and `routes/` next to the calling file, boots the framework, and serves the app when
 * that file is the entry (`bun server.ts`, `bunyad serve`). Tests, the CLI and `bunyad compile` import
 * `createApplication` instead.
 */
export function bunyad(meta: { dir: string; main?: boolean }, options: BunyadOptions = {}) {
  const createApplication = async (create: CreateApplicationOptions = {}): Promise<Application> => {
    const compiled = create.router;
    const router = compiled ?? new Router();
    const app = new Application({ basePath: resolveAppRoot(meta.dir), router });
    app.enableLoadConfigurationOnBoot();
    await app.loadConfiguration();
    loadTranslations(app.basePath(), { locale: app.config.get<string | undefined>("app.locale"), fallback: app.config.get<string | undefined>("app.fallback_locale") });

    await bootFrameworkProviders(app, { except: options.except });
    for (const provider of options.providers ?? []) app.register(provider);
    if (options.middleware) app.middleware(options.middleware);
    for (const [name, stack] of Object.entries(options.groups ?? {})) app.middlewareGroup(name, stack);
    if (!app.getMiddlewareGroup("web")) app.middlewareGroup("web", []);
    if (!app.getMiddlewareGroup("api")) app.middlewareGroup("api", []);

    if (!compiled) await loadRouteModule(app.basePath("routes"), app.router);
    setApplicationInstance(app);
    await app.boot();
    registerErrorPages(app);
    return app;
  };

  if (meta.main || process.env.BUNYAD_SERVE) void createApplication().then((app) => serve(app, options.serve?.(app)));
  return createApplication;
}
