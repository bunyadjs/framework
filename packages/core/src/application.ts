import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ConfigRepository, setConfigInstance } from "@bunyad/config";
import { Container } from "@bunyad/container";
import { abort as httpAbort, type Middleware } from "@bunyad/http";
import { Router, getDefaultRouter, setActiveRouter, registerConventionModels, applyRouteFileBindings } from "@bunyad/router";
import {
  compiledConfigJsonPath,
  compiledConfigModulePath,
  isCompiledBootMode,
} from "./compiled-boot.ts";
import {
  ServiceProvider,
  type ServiceProviderClass,
} from "./service-provider.ts";
import type {
  ExceptionRenderer,
  ShouldRenderJsonWhenCallback,
  ReportableCallback,
  ExceptionContextCallback,
  ExceptionType,
} from "./exception.ts";
import {
  ApplicationBuilder,
} from "./application-builder.ts";

export type Provider = {
  register?(app: Application): void;
  boot?(app: Application): void | Promise<void>;
};

export type ApplicationOptions = {
  basePath?: string;
  config?: Record<string, unknown>;
  router?: Router;
};

type Bootstrapper =
  | ((app: Application) => void | Promise<void>)
  | { bootstrap(app: Application): void | Promise<void> };

type AppCallback = (app: Application) => void;

/**
 * Application container with paths, environment helpers, and provider bootstrap.
 */
export class Application extends Container {
  #basePath: string;
  #appPath: string;
  #bootstrapPath: string;
  #configPath: string;
  #databasePath: string;
  #langPath: string;
  #publicPath: string;
  #resourcePath: string;
  #storagePath: string;
  #environmentPath: string;
  #environmentFile = ".env";
  #namespace = "App";
  #locale = "en";
  #fallbackLocale = "en";
  #providers: Provider[] = [];
  #loadedProviders = new Map<string, Provider>();
  #booted = false;
  #hasBeenBootstrapped = false;
  #middleware: Middleware[] = [];
  #middlewareGroups: Record<string, Middleware[]> = {};
  #routeMiddleware: Record<string, Middleware> = {};
  #middlewarePriority: string[] = [];
  #terminatingCallbacks: Array<() => void | Promise<void>> = [];
  #bootingCallbacks: AppCallback[] = [];
  #bootedCallbacks: AppCallback[] = [];
  #registeredCallbacks: AppCallback[] = [];
  #beforeBootstrapping = new Map<string, AppCallback[]>();
  #afterBootstrapping = new Map<string, AppCallback[]>();
  #exceptionRenderers: ExceptionRenderer[] = [];
  #shouldRenderJsonWhenCallback: ShouldRenderJsonWhenCallback | null = null;
  #dontReport: ExceptionType[] = [];
  #reportableCallbacks: ReportableCallback[] = [];
  #contextCallbacks: ExceptionContextCallback[] = [];
  #dontFlash: string[] = ["password", "password_confirmation", "_token"];
  #redirectGuestsTo: string | ((request: unknown) => string) | undefined;
  #redirectUsersTo: string | ((request: unknown) => string) | undefined;
  #configurationLoaded = false;
  #loadConfigurationOnBoot = false;

  readonly config: ConfigRepository;
  readonly router: Router;

  static configure(basePath?: string): ApplicationBuilder {
    return new ApplicationBuilder(
      new Application({
        basePath: basePath ?? process.cwd(),
        router: new Router(),
      }),
    );
  }

  constructor(options: ApplicationOptions = {}) {
    super();
    this.#basePath = options.basePath ?? process.cwd();
    this.#appPath = join(this.#basePath, "app");
    this.#bootstrapPath = join(this.#basePath, "bootstrap");
    this.#configPath = join(this.#basePath, "config");
    this.#databasePath = join(this.#basePath, "database");
    this.#langPath = join(this.#basePath, "lang");
    this.#publicPath = join(this.#basePath, "public");
    this.#resourcePath = join(this.#basePath, "resources");
    this.#storagePath = join(this.#basePath, "storage");
    this.#environmentPath = this.#basePath;

    const appConfig = (options.config?.app ?? {}) as Record<string, unknown>;
    this.#locale = String(appConfig.locale ?? process.env.APP_LOCALE ?? "en");
    this.#fallbackLocale = String(
      appConfig.fallback_locale ?? process.env.APP_FALLBACK_LOCALE ?? "en",
    );

    this.config = new ConfigRepository(options.config ?? {});
    this.router = options.router ?? getDefaultRouter();
    setActiveRouter(this.router);
    setConfigInstance(this.config);
    this.instance(Application, this);
    this.instance(Container, this);
    this.instance(ConfigRepository, this.config);
    this.instance(Router, this.router);
    Application.setInstance(this);
  }

  /** Framework / app version string. */
  version(): string {
    return String(this.config.get("app.version", "0.0.0"));
  }

  /** Root namespace for the application (e.g. `App`). */
  getNamespace(): string {
    return this.#namespace;
  }

  joinPaths(base: string, path = ""): string {
    if (!path) return base;
    return join(base, path);
  }

  setBasePath(basePath: string): this {
    this.#basePath = basePath;
    this.#appPath = join(basePath, "app");
    this.#bootstrapPath = join(basePath, "bootstrap");
    this.#configPath = join(basePath, "config");
    this.#databasePath = join(basePath, "database");
    this.#langPath = join(basePath, "lang");
    this.#publicPath = join(basePath, "public");
    this.#resourcePath = join(basePath, "resources");
    this.#storagePath = join(basePath, "storage");
    this.#environmentPath = basePath;
    return this;
  }

  basePath(path = ""): string {
    return this.joinPaths(this.#basePath, path);
  }

  path(path = ""): string {
    return this.joinPaths(this.#appPath, path);
  }

  useAppPath(path: string): this {
    this.#appPath = path;
    return this;
  }

  bootstrapPath(path = ""): string {
    return this.joinPaths(this.#bootstrapPath, path);
  }

  useBootstrapPath(path: string): this {
    this.#bootstrapPath = path;
    return this;
  }

  configPath(path = ""): string {
    return this.joinPaths(this.#configPath, path);
  }

  useConfigPath(path: string): this {
    this.#configPath = path;
    return this;
  }

  databasePath(path = ""): string {
    return this.joinPaths(this.#databasePath, path);
  }

  useDatabasePath(path: string): this {
    this.#databasePath = path;
    return this;
  }

  langPath(path = ""): string {
    return this.joinPaths(this.#langPath, path);
  }

  useLangPath(path: string): this {
    this.#langPath = path;
    return this;
  }

  publicPath(path = ""): string {
    return this.joinPaths(this.#publicPath, path);
  }

  usePublicPath(path: string): this {
    this.#publicPath = path;
    return this;
  }

  resourcePath(path = ""): string {
    return this.joinPaths(this.#resourcePath, path);
  }

  storagePath(path = ""): string {
    return this.joinPaths(this.#storagePath, path);
  }

  useStoragePath(path: string): this {
    this.#storagePath = path;
    return this;
  }

  viewPath(path = ""): string {
    return this.joinPaths(join(this.#resourcePath, "views"), path);
  }

  environmentPath(): string {
    return this.#environmentPath;
  }

  useEnvironmentPath(path: string): this {
    this.#environmentPath = path;
    return this;
  }

  environmentFile(): string {
    return this.#environmentFile;
  }

  environmentFilePath(): string {
    return this.joinPaths(this.#environmentPath, this.#environmentFile);
  }

  loadEnvironmentFrom(file: string): this {
    this.#environmentFile = file;
    return this;
  }

  /**
   * Current environment name, or `true`/`false` when compared to one or more names.
   */
  environment(...environments: string[]): string | boolean {
    const current = String(
      this.config.get("app.env", process.env.APP_ENV ?? "production"),
    );
    if (environments.length === 0) return current;
    return environments.some(
      (env) => env.toLowerCase() === current.toLowerCase(),
    );
  }

  isLocal(): boolean {
    return this.environment("local") === true;
  }

  isProduction(): boolean {
    return this.environment("production") === true;
  }

  runningInConsole(): boolean {
    const forced = process.env.APP_RUNNING_IN_CONSOLE;
    if (forced === "1" || forced === "true") return true;
    if (forced === "0" || forced === "false") return false;
    return true;
  }

  runningConsoleCommand(...commands: string[]): boolean {
    if (!this.runningInConsole()) return false;
    if (commands.length === 0) return true;
    const argv = process.argv.slice(2);
    return commands.some((cmd) => argv.includes(cmd));
  }

  runningUnitTests(): boolean {
    return (
      this.environment("testing") === true ||
      process.env.BUN_TEST === "1" ||
      process.env.NODE_ENV === "test"
    );
  }

  hasDebugModeEnabled(): boolean {
    const configured = this.config.get("app.debug");
    if (typeof configured === "boolean") return configured;
    if (process.env.APP_DEBUG === "false" || process.env.APP_DEBUG === "0") {
      return false;
    }
    if (process.env.APP_DEBUG === "true" || process.env.APP_DEBUG === "1") {
      return true;
    }
    return !this.isProduction();
  }

  detectEnvironment(callback: () => string): string {
    const env = callback();
    this.config.set("app.env", env);
    return env;
  }

  isDownForMaintenance(): boolean {
    return existsSync(this.storagePath("framework/down"));
  }

  maintenanceMode(): { active: boolean; path: string } {
    const path = this.storagePath("framework/down");
    return { active: existsSync(path), path };
  }

  getLocale(): string {
    return this.#locale;
  }

  currentLocale(): string {
    return this.getLocale();
  }

  setLocale(locale: string): void {
    this.#locale = locale;
    this.config.set("app.locale", locale);
  }

  isLocale(locale: string): boolean {
    return this.getLocale() === locale;
  }

  getFallbackLocale(): string {
    return this.#fallbackLocale;
  }

  setFallbackLocale(locale: string): void {
    this.#fallbackLocale = locale;
    this.config.set("app.fallback_locale", locale);
  }

  abort(code: number, message = "", headers?: Record<string, string>): never {
    return httpAbort(code, message || undefined, headers);
  }

  renderUsing(callback: ExceptionRenderer): this {
    this.#exceptionRenderers.push(callback);
    return this;
  }

  exceptionRenderers(): ExceptionRenderer[] {
    return this.#exceptionRenderers;
  }

  /** Register the callback that decides JSON vs HTML exception responses. */
  shouldRenderJsonWhen(callback: ShouldRenderJsonWhenCallback): this {
    this.#shouldRenderJsonWhenCallback = callback;
    return this;
  }

  shouldRenderJsonWhenCallback(): ShouldRenderJsonWhenCallback | null {
    return this.#shouldRenderJsonWhenCallback;
  }

  /** Exception classes that should never be reported. */
  dontReport(types: ExceptionType | ExceptionType[]): this {
    const list = Array.isArray(types) ? types : [types];
    this.#dontReport.push(...list);
    return this;
  }

  /** Callback that may force or suppress reporting (`false` skips). */
  reportable(callback: ReportableCallback): this {
    this.#reportableCallbacks.push(callback);
    return this;
  }

  /** Callback that returns extra context merged into the report. */
  context(callback: ExceptionContextCallback): this {
    this.#contextCallbacks.push(callback);
    return this;
  }

  /** Input keys that must not be flashed on validation redirects. */
  dontFlash(keys: string | string[]): this {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (!this.#dontFlash.includes(key)) this.#dontFlash.push(key);
    }
    return this;
  }

  dontFlashKeys(): string[] {
    return [...this.#dontFlash];
  }

  /** Where `auth` middleware sends guests (applied by AuthServiceProvider). */
  redirectGuestsTo(
    path: string | ((request: unknown) => string),
  ): this {
    this.#redirectGuestsTo = path;
    return this;
  }

  getRedirectGuestsTo():
    | string
    | ((request: unknown) => string)
    | undefined {
    return this.#redirectGuestsTo;
  }

  /** Where `guest` middleware sends signed-in users. */
  redirectUsersTo(
    path: string | ((request: unknown) => string),
  ): this {
    this.#redirectUsersTo = path;
    return this;
  }

  getRedirectUsersTo():
    | string
    | ((request: unknown) => string)
    | undefined {
    return this.#redirectUsersTo;
  }

  /** Whether this exception should be reported (status ≥ 500 by default). */
  async shouldReportException(error: unknown, status: number): Promise<boolean> {
    if (status < 500) return false;
    for (const type of this.#dontReport) {
      if (typeof type === "function" && error instanceof type) return false;
    }
    for (const callback of this.#reportableCallbacks) {
      const result = await callback(error);
      if (result === false) return false;
      if (result === true) return true;
    }
    return true;
  }

  /** Gather context from registered `context` callbacks. */
  async exceptionReportContext(
    error: unknown,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const callback of this.#contextCallbacks) {
      const partial = await callback(error);
      if (partial && typeof partial === "object") {
        Object.assign(out, partial);
      }
    }
    return out;
  }

  /**
   * Register a provider object or `ServiceProvider` class.
   */
  register(provider: Provider | ServiceProviderClass): this {
    if (isServiceProviderClass(provider)) {
      const key = provider.name;
      const instance = new provider(this);
      instance.register();
      const wrapped: Provider = {
        boot: () => this.callMethod(instance, "boot") as void | Promise<void>,
      };
      this.#providers.push(wrapped);
      this.#loadedProviders.set(key, wrapped);
      this.#fireRegistered();
      return this;
    }
    provider.register?.(this);
    this.#providers.push(provider);
    const key = provider.constructor?.name ?? `provider:${this.#providers.length}`;
    this.#loadedProviders.set(key, provider);
    this.#fireRegistered();
    return this;
  }

  registered(callback: AppCallback): void {
    this.#registeredCallbacks.push(callback);
  }

  getProviders(): Provider[] {
    return [...this.#providers];
  }

  getLoadedProviders(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const key of this.#loadedProviders.keys()) {
      out[key] = true;
    }
    return out;
  }

  providerIsLoaded(provider: string | ServiceProviderClass): boolean {
    const key = typeof provider === "string" ? provider : provider.name;
    return this.#loadedProviders.has(key);
  }

  booting(callback: AppCallback): void {
    this.#bootingCallbacks.push(callback);
  }

  booted(callback: AppCallback): void {
    if (this.#booted) {
      callback(this);
      return;
    }
    this.#bootedCallbacks.push(callback);
  }

  isBooted(): boolean {
    return this.#booted;
  }

  /** Fluent `create()` apps scan `config/` on `boot()`. Direct `new Application()` does not. */
  enableLoadConfigurationOnBoot(): this {
    this.#loadConfigurationOnBoot = true;
    return this;
  }

  /**
   * Load `config/*.ts` (or compiled `.js`) into the config repository.
   * Default exports may be plain objects or `(databasePath, app) => config`.
   */
  async loadConfiguration(): Promise<this> {
    if (this.#configurationLoaded) {
      return this;
    }
    this.#configurationLoaded = true;

    // Compiled path: use `.build` artifacts — never readdir `config/`.
    if (isCompiledBootMode(this.#basePath)) {
      const modulePath = compiledConfigModulePath(this.#basePath);
      if (existsSync(modulePath)) {
        try {
          const mod = (await import(pathToFileURL(modulePath).href)) as {
            applyCompiledConfig?: (
              set: (name: string, value: unknown) => void,
              databasePath: (path?: string) => string,
              application: Application,
            ) => void;
          };
          mod.applyCompiledConfig?.(
            (name, value) => this.config.set(name, value),
            (path = "") => this.databasePath(path),
            this,
          );
          return this;
        } catch {
          // Fall through to JSON / empty compiled config.
        }
      }
      const jsonPath = compiledConfigJsonPath(this.#basePath);
      if (existsSync(jsonPath)) {
        try {
          const items = (await Bun.file(jsonPath).json()) as Record<
            string,
            unknown
          >;
          for (const [name, value] of Object.entries(items)) {
            if (value !== undefined) this.config.set(name, value);
          }
        } catch {
          // Keep constructor / env defaults.
        }
      }
      return this;
    }

    const dir = this.#configPath;
    if (!existsSync(dir)) {
      return this;
    }

    const files = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const name = entry.name;
      if (name.startsWith(".") || name.endsWith(".d.ts")) {
        continue;
      }
      if (!name.endsWith(".ts") && !name.endsWith(".js")) {
        continue;
      }
      const key = name.replace(/\.(ts|js)$/, "");
      const full = join(dir, name);
      const existing = files.get(key);
      if (existing?.endsWith(".ts") && name.endsWith(".js")) {
        continue;
      }
      files.set(key, full);
    }

    for (const [name, file] of files) {
      try {
        const mod = (await import(pathToFileURL(file).href)) as {
          default?: unknown;
        };
        let value = mod.default;
        if (typeof value === "function") {
          value = (
            value as (
              databasePath: (path?: string) => string,
              application: Application,
            ) => unknown
          )((path = "") => this.databasePath(path), this);
        }
        if (value !== undefined) {
          this.config.set(name, value);
        }
      } catch {
        // Optional config — callers keep using env defaults.
      }
    }
    return this;
  }

  async boot(): Promise<this> {
    if (this.#booted) return this;
    if (this.#loadConfigurationOnBoot) {
      await this.loadConfiguration();
    }
    for (const cb of this.#bootingCallbacks) cb(this);
    for (const provider of this.#providers) {
      await provider.boot?.(this);
    }
    const compiled = isCompiledBootMode(this.#basePath);
    if (!compiled) {
      // Source-dev only: stamp inject plans for typed closures in routes/*
      // and bind unbound {user} → Models/User. Compiled apps use `.build`
      // routes + models (createCompiledRouter) and skip Glob/readdir.
      await this.#stampRouteFileBindings();
      await registerConventionModels(this.router, this.path("Models"));
    }
    // Prefer radix matching once routes are registered.
    this.router.optimize();
    this.#booted = true;
    for (const cb of this.#bootedCallbacks) cb(this);
    return this;
  }

  async #stampRouteFileBindings(): Promise<void> {
    const routesDir = this.basePath("routes");
    if (!existsSync(routesDir)) return;
    // Every routes/*.ts module (web, api, central, admin, spa, …) — not only web/api.
    const glob = new Bun.Glob("**/*.{ts,js}");
    for await (const rel of glob.scan({ cwd: routesDir, absolute: false })) {
      await applyRouteFileBindings(this.router, join(routesDir, rel));
    }
  }

  beforeBootstrapping(bootstrapper: string, callback: AppCallback): void {
    const list = this.#beforeBootstrapping.get(bootstrapper) ?? [];
    list.push(callback);
    this.#beforeBootstrapping.set(bootstrapper, list);
  }

  afterBootstrapping(bootstrapper: string, callback: AppCallback): void {
    const list = this.#afterBootstrapping.get(bootstrapper) ?? [];
    list.push(callback);
    this.#afterBootstrapping.set(bootstrapper, list);
  }

  afterLoadingEnvironment(callback: AppCallback): void {
    this.afterBootstrapping("LoadEnvironment", callback);
  }

  async bootstrapWith(bootstrappers: Bootstrapper[]): Promise<this> {
    this.#hasBeenBootstrapped = true;
    for (const bootstrapper of bootstrappers) {
      const name =
        typeof bootstrapper === "function"
          ? bootstrapper.name || "bootstrapper"
          : bootstrapper.constructor.name;
      for (const cb of this.#beforeBootstrapping.get(name) ?? []) cb(this);
      if (typeof bootstrapper === "function") {
        await bootstrapper(this);
      } else {
        await bootstrapper.bootstrap(this);
      }
      for (const cb of this.#afterBootstrapping.get(name) ?? []) cb(this);
    }
    return this;
  }

  hasBeenBootstrapped(): boolean {
    return this.#hasBeenBootstrapped;
  }

  terminating(callback: () => void | Promise<void>): this {
    this.#terminatingCallbacks.push(callback);
    return this;
  }

  async terminate(): Promise<void> {
    for (const cb of this.#terminatingCallbacks) {
      await cb();
    }
  }

  middleware(stack: Middleware[]): this {
    this.#middleware = stack;
    return this;
  }

  getMiddleware(): Middleware[] {
    return this.#middleware;
  }

  /**
   * Named middleware groups (e.g. `web` / `api`).
   * Route stacks may include the group name; the kernel expands it.
   */
  middlewareGroup(name: string, stack: Middleware[]): this {
    this.#middlewareGroups[name] = stack;
    return this;
  }

  getMiddlewareGroup(name: string): Middleware[] | undefined {
    return this.#middlewareGroups[name];
  }

  /** Replace the middleware priority list (alias names, first = highest priority). */
  middlewarePriority(list: string[]): this {
    this.#middlewarePriority = [...list];
    return this;
  }

  getMiddlewarePriority(): readonly string[] {
    return this.#middlewarePriority;
  }

  /** Insert `prepend` immediately before `before` in the priority list. */
  prependToPriorityList(before: string | string[], prepend: string): this {
    const anchors = Array.isArray(before) ? before : [before];
    const next = [...this.#middlewarePriority];
    let idx = -1;
    for (const anchor of anchors) {
      idx = next.indexOf(anchor);
      if (idx !== -1) break;
    }
    if (idx === -1) {
      next.unshift(prepend);
    } else {
      next.splice(idx, 0, prepend);
    }
    this.#middlewarePriority = next;
    return this;
  }

  /** Insert `append` immediately after `after` in the priority list. */
  appendToPriorityList(after: string | string[], append: string): this {
    const anchors = Array.isArray(after) ? after : [after];
    const next = [...this.#middlewarePriority];
    let idx = -1;
    for (const anchor of anchors) {
      idx = next.indexOf(anchor);
      if (idx !== -1) break;
    }
    if (idx === -1) {
      next.push(append);
    } else {
      next.splice(idx + 1, 0, append);
    }
    this.#middlewarePriority = next;
    return this;
  }

  routeMiddleware(map: Record<string, Middleware>): this {
    Object.assign(this.#routeMiddleware, map);
    return this;
  }

  resolveMiddleware(name: string): Middleware {
    return this.#routeMiddleware[name]!;
  }

  #fireRegistered(): void {
    for (const cb of this.#registeredCallbacks) cb(this);
  }
}

function isServiceProviderClass(
  value: Provider | ServiceProviderClass,
): value is ServiceProviderClass {
  return (
    typeof value === "function" &&
    (value === ServiceProvider ||
      value.prototype instanceof ServiceProvider)
  );
}

let appInstance: Application | undefined;

export function app(): Application {
  return appInstance!;
}

export function setApplicationInstance(application: Application): void {
  appInstance = application;
  Application.setInstance(application);
  setActiveRouter(application.router);
}
