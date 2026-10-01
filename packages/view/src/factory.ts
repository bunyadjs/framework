import { existsSync, readFileSync } from "node:fs";
import { BunyadError } from "@bunyad/common";
import {
  compile,
  type ComponentRenderer,
  type IncludeRenderer,
} from "./compiler.ts";
import type { ComponentClass } from "./component.ts";
import { resolveLayouts } from "./layouts.ts";

export type ViewRenderer = (
  data?: Record<string, unknown>,
  c?: ComponentRenderer,
  i?: IncludeRenderer,
) => string;

export type ViewFactoryOptions = {
  /** Precompiled renderers (name → render). Skips disk compile when hit. */
  compiled?: Record<string, ViewRenderer>;
  /**
   * Production/compiled boot: never compile from disk.
   * Missing names throw `BUNYAD_VIEW_001` (no Glob / no runtime compile).
   */
  compiledOnly?: boolean;
};

/**
 * Helpers copied from `globalThis` into every view data bag so templates can
 * call `route()`, `config()`, `asset()`, etc. without `@use` (free names
 * resolve from `__d`, not process globals).
 */
const SHARED_VIEW_HELPERS = [
  "route",
  "url",
  "asset",
  "action",
  "config",
  "csrf_token",
  "session",
  "request",
  "app",
  "env",
  "now",
  "today",
  "blank",
  "filled",
  "collect",
  "dd",
  "dump",
] as const;

function sharedViewHelpers(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const g = globalThis as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of SHARED_VIEW_HELPERS) {
    if (Object.prototype.hasOwnProperty.call(data, name)) continue;
    const value = g[name];
    if (typeof value === "function") out[name] = value;
  }
  return out;
}

/**
 * Loads `.view` files, compiles once, caches render functions.
 */
export class ViewFactory {
  readonly #path: string;
  readonly #cache = new Map<string, ViewRenderer>();
  readonly #components = new Map<string, ComponentClass>();
  readonly #helpers = new Map<string, unknown>();
  readonly #shared: Record<string, unknown> = {};
  readonly #composers: Array<{
    patterns: string[];
    callback: (
      data: Record<string, unknown>,
      name: string,
    ) => void | Record<string, unknown>;
  }> = [];
  #requestData: (() => Record<string, unknown>) | undefined;
  #compiled: Record<string, ViewRenderer> | undefined;
  readonly #compiledOnly: boolean;

  constructor(path: string, options: ViewFactoryOptions = {}) {
    this.#path = path;
    this.#compiled = options.compiled;
    this.#compiledOnly = options.compiledOnly ?? false;
  }

  /**
   * Data resolved on every render, beneath `share()` and view data — for
   * per-request values such as flashed `errors` and old input.
   */
  shareUsing(resolver: (() => Record<string, unknown>) | undefined): this {
    this.#requestData = resolver;
    return this;
  }

  /** Register a class-based `<x-name>` component. */
  component(name: string, ctor: ComponentClass): this {
    this.#components.set(name, ctor);
    return this;
  }

  /**
   * Register a template helper for `@use('name')` / `@import('name')`.
   * Helpers must be registered in app code (providers) — templates cannot
   * import arbitrary modules or filesystem paths.
   */
  use(name: string, value: unknown): this {
    if (
      !name ||
      name.includes("..") ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes(":")
    ) {
      throw new BunyadError(
        `View helper name [${name}] is invalid.`,
        "BUNYAD_VIEW_006",
      );
    }
    this.#helpers.set(name, value);
    return this;
  }

  /** Remove one helper, or all helpers when `name` is omitted. */
  forgetUse(name?: string): this {
    if (name === undefined) this.#helpers.clear();
    else this.#helpers.delete(name);
    return this;
  }

  /**
   * Share data with every view. Pass a key/value pair or a record of keys.
   */
  share(key: string | Record<string, unknown>, value?: unknown): this {
    if (typeof key === "string") {
      this.#shared[key] = value;
    } else {
      Object.assign(this.#shared, key);
    }
    return this;
  }

  /** Shared data bag (copy). */
  getShared(): Record<string, unknown> {
    return { ...this.#shared };
  }

  /**
   * Run a callback before rendering matching views. Patterns may include `*`.
   * The callback may mutate `data` or return an object merged into it.
   */
  composer(
    views: string | string[],
    callback: (
      data: Record<string, unknown>,
      name: string,
    ) => void | Record<string, unknown>,
  ): this {
    const patterns = Array.isArray(views) ? views : [views];
    this.#composers.push({ patterns, callback });
    return this;
  }

  /** Whether a view exists on disk or in the precompiled map. */
  exists(name: string): boolean {
    if (this.#compiled?.[name]) return true;
    if (this.#cache.has(name)) return true;
    const file = `${this.#path}/${name.replaceAll(".", "/")}.view`;
    return existsSync(file);
  }

  /**
   * Render the first view name that exists. Throws when none exist.
   */
  first(
    names: string[],
    data: Record<string, unknown> = {},
  ): string {
    for (const name of names) {
      if (this.exists(name)) return this.render(name, data);
    }
    throw new BunyadError(
      `None of the views [${names.join(", ")}] exist.`,
      "BUNYAD_VIEW_001",
    );
  }

  render(name: string, data: Record<string, unknown> = {}): string {
    const requestData = this.#requestData?.();
    const _old =
      (data._old as Record<string, unknown> | undefined) ??
      (requestData?._old as Record<string, unknown> | undefined) ??
      {};
    const helpers: Record<string, unknown> = {};
    for (const [key, value] of this.#helpers) {
      helpers[key] = value;
    }
    const bag: Record<string, unknown> = {
      ...sharedViewHelpers(data),
      ...requestData,
      ...this.#shared,
      ...data,
      __helpers: helpers,
      old(key: string, defaultValue: unknown = "") {
        return Object.prototype.hasOwnProperty.call(_old, key)
          ? _old[key]
          : defaultValue;
      },
    };

    for (const { patterns, callback } of this.#composers) {
      if (!patterns.some((p) => viewNameMatches(p, name))) continue;
      const extra = callback(bag, name);
      if (extra && typeof extra === "object") Object.assign(bag, extra);
    }

    const renderComponent: ComponentRenderer = (component, props) => {
      const parentAware = {
        ...(bag.__aware as Record<string, unknown> | undefined),
        ...bag,
      };
      const Ctor = this.#components.get(component);
      if (Ctor) {
        const instance = Object.assign(new Ctor(), props);
        return this.render(instance.render(), {
          errors: bag.errors,
          _old,
          __stacks: bag.__stacks,
          __once: bag.__once,
          __aware: parentAware,
          ...instance.data(),
        });
      }

      const viewName = `components.${component.replaceAll("/", ".")}`;
      return this.render(viewName, {
        errors: bag.errors,
        _old,
        __stacks: bag.__stacks,
        __once: bag.__once,
        __aware: parentAware,
        ...props,
      });
    };

    const renderInclude: IncludeRenderer = (includeName, includeData) => {
      return this.render(includeName, includeData);
    };

    return this.#resolve(name)(bag, renderComponent, renderInclude);
  }

  /**
   * Drop in-memory renderers. Also forgets precompiled `.build/views` so the
   * next render recompiles from disk (needed for live reload in development).
   */
  clearCache(): void {
    this.#cache.clear();
    this.#compiled = undefined;
  }

  #read(name: string): string {
    const file = `${this.#path}/${name.replaceAll(".", "/")}.view`;
    if (!existsSync(file)) {
      throw new BunyadError(`View [${name}] not found.`, "BUNYAD_VIEW_001");
    }
    return readFileSync(file, "utf8");
  }

  #devReload(): boolean {
    return (
      process.env.BUNYAD_DEV === "1" ||
      process.env.BUNYAD_HOT === "1"
    );
  }

  #resolve(name: string): ViewRenderer {
    // Compiled-only boot: never touch disk (production / binary embeds).
    if (this.#compiledOnly) {
      const cached = this.#cache.get(name);
      if (cached) return cached;

      const precompiled = this.#compiled?.[name];
      if (precompiled) {
        this.#cache.set(name, precompiled);
        return precompiled;
      }

      throw new BunyadError(
        `View [${name}] not found in compiled views.`,
        "BUNYAD_VIEW_001",
      );
    }

    // In development, always recompile from disk so edits show up even if the
    // browser reloads before the watcher clears the cache.
    if (!this.#devReload()) {
      const cached = this.#cache.get(name);
      if (cached) return cached;

      const precompiled = this.#compiled?.[name];
      if (precompiled) {
        this.#cache.set(name, precompiled);
        return precompiled;
      }
    }

    const source = resolveLayouts(this.#read(name), (layout) => this.#read(layout));
    const compiled = compile(source);
    const renderer: ViewRenderer = (data = {}, c, i) => compiled(data, c, i);
    if (!this.#devReload()) {
      this.#cache.set(name, renderer);
    }
    return renderer;
  }
}

/** Match a composer pattern (`*`, `profiles.*`) against a view name. */
function viewNameMatches(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (pattern === name) return true;
  if (!pattern.includes("*")) return false;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(name);
}
