import { join, isAbsolute } from "node:path";
import { aliasMiddleware, json, type Middleware, type Request } from "@bunyad/http";
import { loadRouteModule, type Router } from "@bunyad/router";
import {
  Application,
  setApplicationInstance,
  type Provider,
} from "./application.ts";
import type { ServiceProviderClass } from "./service-provider.ts";
import type {
  ExceptionRenderer,
  ShouldRenderJsonWhenCallback,
  ReportableCallback,
  ExceptionContextCallback,
  ExceptionType,
} from "./exception.ts";

type GuestRedirect =
  | string
  | ((request: Request) => string);

export type RouteRegistrar = string | ((router: Router) => void);

export type RoutingOptions = {
  /**
   * API routes — Laravel path string (`routes/api.ts`) or registrar callback.
   * Path form applies the `api` middleware group and `apiPrefix` (default `api`).
   */
  api?: RouteRegistrar;
  /**
   * Web routes — Laravel path string (`routes/web.ts`) or registrar callback.
   * Path form applies the `web` middleware group.
   */
  web?: RouteRegistrar;
  /** Prefix for path-based `api` routes (Laravel default `api`). */
  apiPrefix?: string;
  health?: string;
  then?: (app: Application) => void;
};

export type MiddlewareFactory = (
  ...params: string[]
) => Middleware;

/** Callbacks used by `withMiddleware()`. */
export class MiddlewareConfigurator {
  constructor(private app: Application) {}

  alias(map: Record<string, MiddlewareFactory>): this {
    for (const [name, factory] of Object.entries(map)) {
      aliasMiddleware(name, factory);
    }
    return this;
  }

  append(stack: Middleware[]): this {
    this.app.middleware([...this.app.getMiddleware(), ...stack]);
    return this;
  }

  prepend(stack: Middleware[]): this {
    this.app.middleware([...stack, ...this.app.getMiddleware()]);
    return this;
  }

  web(options: { append?: Middleware[] } = {}): this {
    const current = this.app.getMiddlewareGroup("web") ?? [];
    this.app.middlewareGroup("web", [
      ...current,
      ...(options.append ?? []),
    ]);
    return this;
  }

  api(options: { append?: Middleware[] } = {}): this {
    const current = this.app.getMiddlewareGroup("api") ?? [];
    this.app.middlewareGroup("api", [
      ...current,
      ...(options.append ?? []),
    ]);
    return this;
  }

  group(name: string, stack: Middleware[]): this {
    this.app.middlewareGroup(name, stack);
    return this;
  }

  appendToGroup(name: string, stack: Middleware[]): this {
    const current = this.app.getMiddlewareGroup(name) ?? [];
    this.app.middlewareGroup(name, [...current, ...stack]);
    return this;
  }

  /** Replace the middleware priority list. */
  priority(list: string[]): this {
    this.app.middlewarePriority(list);
    return this;
  }

  /** Insert middleware before another entry in the priority list. */
  prependToPriorityList(before: string | string[], prepend: string): this {
    this.app.prependToPriorityList(before, prepend);
    return this;
  }

  /** Insert middleware after another entry in the priority list. */
  appendToPriorityList(after: string | string[], append: string): this {
    this.app.appendToPriorityList(after, append);
    return this;
  }

  /**
   * Default redirect for guests hitting `auth` middleware.
   */
  redirectGuestsTo(path: GuestRedirect): this {
    this.app.redirectGuestsTo(path as unknown as string | ((request: unknown) => string));
    return this;
  }

  /**
   * Default redirect for authenticated users hitting `guest` middleware.
   */
  redirectUsersTo(path: GuestRedirect): this {
    this.app.redirectUsersTo(path as unknown as string | ((request: unknown) => string));
    return this;
  }
}

/** Callbacks used by `withExceptions()`. */
export class ExceptionsConfigurator {
  constructor(private app: Application) {}

  render(callback: ExceptionRenderer): this {
    this.app.renderUsing(callback);
    return this;
  }

  /** Decide when exception responses should be JSON (`request.expectsJson()` by default). */
  shouldRenderJsonWhen(callback: ShouldRenderJsonWhenCallback): this {
    this.app.shouldRenderJsonWhen(callback);
    return this;
  }

  /** Exception classes that should never be reported. */
  dontReport(types: ExceptionType | ExceptionType[]): this {
    this.app.dontReport(types);
    return this;
  }

  /** Callback that may force or suppress reporting (`false` skips). */
  reportable(callback: ReportableCallback): this {
    this.app.reportable(callback);
    return this;
  }

  /** Callback that returns extra context merged into the report. */
  context(callback: ExceptionContextCallback): this {
    this.app.context(callback);
    return this;
  }

  /** Input keys that must not be flashed on validation redirects. */
  dontFlash(keys: string | string[]): this {
    this.app.dontFlash(keys);
    return this;
  }
}

/**
 * Fluent boot: `await Application.configure(basePath).withRouting().withMiddleware().create()`.
 */
export class ApplicationBuilder {
  #routing: RoutingOptions = {};
  #middlewareCallback?: (middleware: MiddlewareConfigurator) => void;
  #exceptionsCallback?: (exceptions: ExceptionsConfigurator) => void;
  #providers: Array<Provider | ServiceProviderClass> = [];
  #guestsRedirect?: GuestRedirect;
  #usersRedirect?: GuestRedirect;

  constructor(private app: Application) {}

  withRouting(options: RoutingOptions): this {
    this.#routing = options;
    return this;
  }

  /** App-level default for `auth` middleware guest redirects. */
  redirectGuestsTo(path: GuestRedirect): this {
    this.#guestsRedirect = path;
    return this;
  }

  /** App-level default for `guest` middleware authenticated redirects. */
  redirectUsersTo(path: GuestRedirect): this {
    this.#usersRedirect = path;
    return this;
  }

  withMiddleware(
    callback: (middleware: MiddlewareConfigurator) => void,
  ): this {
    this.#middlewareCallback = callback;
    return this;
  }

  withExceptions(
    callback: (exceptions: ExceptionsConfigurator) => void,
  ): this {
    this.#exceptionsCallback = callback;
    return this;
  }

  withProviders(
    providers: Array<Provider | ServiceProviderClass>,
  ): this {
    this.#providers = providers;
    return this;
  }

  /**
   * Build the application. Async so Laravel path-string `web`/`api` route files
   * can be loaded before `then` (same order as Laravel's booting callback).
   */
  async create(): Promise<Application> {
    // Laravel order: load `config/` before provider `register()` so framework
    // providers (session, log, mail, …) see app config. `boot()` still calls
    // `loadConfiguration()` idempotently via enableLoadConfigurationOnBoot.
    this.app.enableLoadConfigurationOnBoot();
    await this.app.loadConfiguration();
    this.#middlewareCallback?.(new MiddlewareConfigurator(this.app));
    if (this.#guestsRedirect !== undefined) {
      this.app.redirectGuestsTo(
        this.#guestsRedirect as unknown as string | ((request: unknown) => string),
      );
    }
    if (this.#usersRedirect !== undefined) {
      this.app.redirectUsersTo(
        this.#usersRedirect as unknown as string | ((request: unknown) => string),
      );
    }
    for (const provider of this.#providers) {
      this.app.register(provider);
    }
    if (!this.app.getMiddlewareGroup("web")) {
      this.app.middlewareGroup("web", []);
    }
    if (!this.app.getMiddlewareGroup("api")) {
      this.app.middlewareGroup("api", []);
    }
    await this.#registerRouting();
    this.#routing.then?.(this.app);
    this.#exceptionsCallback?.(new ExceptionsConfigurator(this.app));
    setApplicationInstance(this.app);
    return this.app;
  }

  async #registerRouting(): Promise<void> {
    const apiPrefix = this.#routing.apiPrefix ?? "api";

    if (this.#routing.api) {
      const api = this.#routing.api;
      if (typeof api === "string") {
        const path = this.#resolveRoutePath(api);
        // loadRouteModule applies api group + prefix for routes/api.ts
        await loadRouteModule(path, this.app.router, {
          apiPrefix: apiPrefix === "" ? false : apiPrefix,
        });
      } else {
        this.app.router.middleware("api").prefix(apiPrefix).group(() => {
          api(this.app.router);
        });
      }
    }

    if (this.#routing.web) {
      const web = this.#routing.web;
      if (typeof web === "string") {
        const path = this.#resolveRoutePath(web);
        await this.app.router.middleware("web").group(async () => {
          await loadRouteModule(path, this.app.router, { apiPrefix: false });
        });
      } else {
        this.app.router.middleware("web").group(() => {
          web(this.app.router);
        });
      }
    }

    if (this.#routing.health) {
      this.app.router.get(this.#routing.health, () => json({ status: "ok" }));
    }
  }

  #resolveRoutePath(path: string): string {
    if (isAbsolute(path) || path.startsWith("file:")) return path;
    return join(this.app.basePath(), path);
  }
}
