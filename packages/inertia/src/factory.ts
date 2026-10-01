import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "@bunyad/http";
import { getViewFactory } from "@bunyad/view";
import { encodePageJson, type InertiaPage } from "./page.ts";
import {
  AlwaysProp,
  DeferProp,
  isAlwaysProp,
  isDeferProp,
  isDeferredLike,
  isLazyProp,
  isMergeProp,
  isOnceProp,
  isOptionalProp,
  isScrollProp,
  LazyProp,
  OptionalProp,
  type PropResolver,
  type ScrollPaginator,
} from "./props.ts";
import {
  configureSsr,
  dispatchSsr,
  formatSsrHead,
  getSsrOptions,
  resetSsrOptions,
  type SsrOptions,
} from "./ssr.ts";

/** Session key for `Inertia.flash()` values, delivered as the page's `flash`. */
export const FLASH_KEY = "_inertia_flash";

export type SharedPropValue =
  | unknown
  | ((request: Request) => unknown | Promise<unknown>);

export type VersionValue = string | number | null | (() => string | number | null);

type SharedBag = Record<string, SharedPropValue>;

// App-wide values, set at boot (`Inertia.share(...)` in a provider).
let rootView = "app";
let shared: SharedBag = {};
let versionResolver: VersionValue = null;
let encryptHistory = false;

/**
 * Values the Inertia middleware sets for one request. The factory is shared
 * by every request, so per-request shares (the signed-in user, flash, errors)
 * must not land in the app-wide bag, where a concurrent request would read them.
 */
type RequestState = {
  rootView?: string;
  version?: VersionValue;
  shared: SharedBag;
};

const requestState = new AsyncLocalStorage<RequestState>();

/** Run `fn` with its own root view, version, and shared props. */
export function runInertiaRequest<T>(fn: () => T): T {
  return requestState.run({ shared: {} }, fn);
}

function currentShared(): SharedBag {
  const scoped = requestState.getStore()?.shared;
  return scoped ? { ...shared, ...scoped } : shared;
}

function currentRootView(): string {
  return requestState.getStore()?.rootView ?? rootView;
}

function currentVersion(): VersionValue {
  const scoped = requestState.getStore();
  return scoped?.version !== undefined ? scoped.version : versionResolver;
}

export function resetInertiaState(): void {
  rootView = "app";
  shared = {};
  versionResolver = null;
  encryptHistory = false;
  resetSsrOptions();
}

export class ResponseFactory {
  setRootView(name: string): this {
    const scoped = requestState.getStore();
    if (scoped) scoped.rootView = name;
    else rootView = name;
    return this;
  }

  getRootView(): string {
    return currentRootView();
  }

  share(key: string, value: SharedPropValue): this;
  share(data: Record<string, SharedPropValue>): this;
  share(
    keyOrData: string | Record<string, SharedPropValue>,
    value?: SharedPropValue,
  ): this {
    const bag = requestState.getStore()?.shared ?? shared;
    if (typeof keyOrData === "string") {
      bag[keyOrData] = value;
      return this;
    }
    Object.assign(bag, keyOrData);
    return this;
  }

  getShared(key?: string): unknown {
    const bag = currentShared();
    if (key === undefined) return { ...bag };
    return bag[key];
  }

  flushShared(): this {
    shared = {};
    return this;
  }

  version(value: VersionValue): this {
    const scoped = requestState.getStore();
    if (scoped) scoped.version = value;
    else versionResolver = value;
    return this;
  }

  getVersion(): string | null {
    const resolver = currentVersion();
    const v = typeof resolver === "function" ? resolver() : resolver;
    if (v == null) return null;
    return String(v);
  }

  encryptHistory(value = true): this {
    encryptHistory = value;
    return this;
  }

  /** Configure Inertia SSR gateway (`enabled`, `url`, `timeout`, `except`). */
  ssr(options: SsrOptions): this {
    configureSsr(options);
    return this;
  }

  getSsr(): SsrOptions {
    return getSsrOptions();
  }

  lazy(callback: PropResolver): LazyProp {
    return new LazyProp(callback);
  }

  optional(callback: PropResolver): OptionalProp {
    return new OptionalProp(callback);
  }

  defer(callback: PropResolver, group: string | null = "default"): DeferProp {
    return new DeferProp(callback, group);
  }

  always(callback: PropResolver): AlwaysProp {
    return new AlwaysProp(callback);
  }

  location(url: string): Response {
    return new Response("", {
      status: 409,
      headers: {
        "X-Inertia-Location": url,
      },
    });
  }

  render(
    component: string,
    props: Record<string, unknown> = {},
  ): InertiaResponse {
    return new InertiaResponse(component, props);
  }
}

export class InertiaResponse {
  #component: string;
  #props: Record<string, unknown>;
  #viewData: Record<string, unknown> = {};
  #rootView: string | undefined;
  #version: VersionValue | undefined;
  #encryptHistory: boolean | undefined;
  #clearHistory = false;

  constructor(component: string, props: Record<string, unknown> = {}) {
    this.#component = component;
    this.#props = props;
  }

  with(key: string, value: unknown): this;
  with(data: Record<string, unknown>): this;
  with(keyOrData: string | Record<string, unknown>, value?: unknown): this {
    if (typeof keyOrData === "string") {
      this.#props[keyOrData] = value;
      return this;
    }
    Object.assign(this.#props, keyOrData);
    return this;
  }

  withViewData(key: string, value: unknown): this;
  withViewData(data: Record<string, unknown>): this;
  withViewData(
    keyOrData: string | Record<string, unknown>,
    value?: unknown,
  ): this {
    if (typeof keyOrData === "string") {
      this.#viewData[keyOrData] = value;
      return this;
    }
    Object.assign(this.#viewData, keyOrData);
    return this;
  }

  rootView(name: string): this {
    this.#rootView = name;
    return this;
  }

  version(value: VersionValue): this {
    this.#version = value;
    return this;
  }

  encryptHistory(value = true): this {
    this.#encryptHistory = value;
    return this;
  }

  clearHistory(value = true): this {
    this.#clearHistory = value;
    return this;
  }

  async toResponse(request: Request): Promise<Response> {
    const page = await this.#buildPage(request);
    const isInertia = request.header("x-inertia") === "true";

    if (isInertia) {
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Vary: "X-Inertia",
          "X-Inertia": "true",
          "X-Inertia-Version": page.version ?? "",
        },
      });
    }

    const viewName = this.#rootView ?? currentRootView();
    const pageJson = encodePageJson(page);
    const ssr = await dispatchSsr(page);
    const ssrHead = formatSsrHead(ssr?.head);
    const ssrBody = ssr?.body ?? "";

    let html: string;
    try {
      html = getViewFactory().render(viewName, {
        ...this.#viewData,
        page,
        pageJson,
        ssrHead,
        ssrBody,
      });
    } catch {
      html = defaultRootHtml(pageJson, ssrHead, ssrBody);
    }

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        Vary: "X-Inertia",
      },
    });
  }

  async #buildPage(request: Request): Promise<InertiaPage> {
    const partialComponent = request.header("x-inertia-partial-component");
    const onlyHeader = request.header("x-inertia-partial-data");
    const exceptHeader = request.header("x-inertia-partial-except");
    const isPartial =
      partialComponent === this.#component &&
      (onlyHeader != null || exceptHeader != null);

    const only = onlyHeader
      ? onlyHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const except = exceptHeader
      ? exceptHeader.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const list = (header: string | null | undefined) =>
      header ? header.split(",").map((s) => s.trim()).filter(Boolean) : [];
    // Props the client asked to replace rather than merge (`router.reload({ reset })`).
    const reset = list(request.header("x-inertia-reset"));
    // Once props the client still holds; skipped unless asked for by name.
    const exceptOnce = list(request.header("x-inertia-except-once-props"));
    const scrollIntent = request.header("x-inertia-infinite-scroll-merge-intent") === "prepend" ? "prepend" : "append";

    const sharedResolved = await resolveShared(request);
    const merged: Record<string, unknown> = {
      ...sharedResolved,
      ...this.#props,
    };

    const deferredProps = collectDeferredGroups(merged, isPartial);
    const paginators: Record<string, ScrollPaginator> = {};
    const props = await resolveProps(merged, {
      isPartial,
      only,
      except,
      exceptOnce,
      paginators,
    });

    const versionValue =
      this.#version !== undefined
        ? typeof this.#version === "function"
          ? this.#version()
          : this.#version
        : factory.getVersion();

    const page: InertiaPage = {
      component: this.#component,
      props,
      url: inertiaUrl(request),
      version: versionValue == null ? null : String(versionValue),
      clearHistory: this.#clearHistory,
      encryptHistory: this.#encryptHistory ?? encryptHistory,
      sharedProps: Object.keys(sharedResolved),
    };

    if (deferredProps && Object.keys(deferredProps).length > 0) {
      page.deferredProps = deferredProps;
    }

    // How the client folds a partial reload into what it has.
    const mergeProps: string[] = [];
    const prependProps: string[] = [];
    const deepMergeProps: string[] = [];
    const matchPropsOn: string[] = [];
    const scrollProps: NonNullable<InertiaPage["scrollProps"]> = {};
    const onceProps: NonNullable<InertiaPage["onceProps"]> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (isOnceProp(value)) onceProps[value.key ?? key] = { prop: key, expiresAt: value.expiresAt };
      if (!(key in props)) continue;
      if (isScrollProp(value)) {
        const paginator = paginators[key]!;
        scrollProps[key] = {
          pageName: paginator.options?.pageName ?? "page",
          previousPage: paginator.currentPage > 1 ? paginator.currentPage - 1 : null,
          nextPage: paginator.hasMorePages() ? paginator.currentPage + 1 : null,
          currentPage: paginator.currentPage,
          reset: reset.includes(key),
        };
        if (!reset.includes(key)) (scrollIntent === "prepend" ? prependProps : mergeProps).push(`${key}.${value.wrapper}`);
      }
      if (isMergeProp(value) && !reset.includes(key)) {
        if (value.deep) deepMergeProps.push(key);
        else (value.direction === "prepend" ? prependProps : mergeProps).push(key);
        for (const field of value.matchKeys) matchPropsOn.push(`${key}.${field}`);
      }
    }
    if (mergeProps.length > 0) page.mergeProps = mergeProps;
    if (prependProps.length > 0) page.prependProps = prependProps;
    if (deepMergeProps.length > 0) page.deepMergeProps = deepMergeProps;
    if (matchPropsOn.length > 0) page.matchPropsOn = matchPropsOn;
    if (Object.keys(scrollProps).length > 0) page.scrollProps = scrollProps;
    if (Object.keys(onceProps).length > 0) page.onceProps = onceProps;

    // `Inertia.flash()` values: shown once, then gone.
    const flash = request.session?.get<Record<string, unknown> | undefined>(FLASH_KEY);
    if (flash && Object.keys(flash).length > 0) {
      page.flash = flash;
      request.session!.forget(FLASH_KEY);
    }

    return page;
  }
}

function defaultRootHtml(
  pageJson: string,
  ssrHead = "",
  ssrBody = "",
): string {
  if (ssrBody) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${ssrHead}
</head>
<body>
  ${ssrBody}
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script data-page="app" type="application/json">${pageJson}</script>
  <div id="app"></div>
</body>
</html>`;
}

function inertiaUrl(request: Request): string {
  const u = new URL(request.url);
  return `${u.pathname}${u.search}`;
}

async function resolveShared(
  request: Request,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(currentShared())) {
    out[key] =
      typeof value === "function"
        ? await (value as (request: Request) => unknown | Promise<unknown>)(
            request,
          )
        : value;
  }
  return out;
}

function collectDeferredGroups(
  props: Record<string, unknown>,
  isPartial: boolean,
): Record<string, string[]> | undefined {
  if (isPartial) return undefined;
  const groups: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(props)) {
    if (isDeferProp(value)) {
      const group = value.group ?? "default";
      groups[group] ??= [];
      groups[group]!.push(key);
    }
  }
  return Object.keys(groups).length > 0 ? groups : undefined;
}

async function resolveProps(
  props: Record<string, unknown>,
  options: {
    isPartial: boolean;
    only: string[] | null;
    except: string[];
    exceptOnce: string[];
    /** Filled with the paginator behind each scroll prop. */
    paginators: Record<string, ScrollPaginator>;
  },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const resolve = async (key: string, value: unknown) => {
    if (!isScrollProp(value)) return resolveValue(value);
    const paginator = await value.callback();
    options.paginators[key] = paginator;
    return paginator.toJSON();
  };

  for (const [key, value] of Object.entries(props)) {
    const always = isAlwaysProp(value);
    // The client keeps a once prop it already has, unless this reload names it.
    if (isOnceProp(value) && options.exceptOnce.includes(value.key ?? key) && !options.only?.includes(key)) continue;

    if (options.isPartial) {
      if (always) {
        out[key] = await resolveValue(value);
        continue;
      }
      if (options.only && !options.only.includes(key)) continue;
      if (options.except.includes(key)) continue;
      if (isDeferredLike(value) && options.only && !options.only.includes(key)) {
        continue;
      }
      const resolved = await resolve(key, value);
      if (resolved === undefined) continue;
      out[key] = resolved;
      continue;
    }

    // Full page load: skip lazy/optional; defer listed in deferredProps only
    if (isLazyProp(value) || isOptionalProp(value) || isDeferProp(value)) {
      continue;
    }

    if (options.except.includes(key)) continue;
    out[key] = await resolve(key, value);
  }

  return out;
}

async function resolveValue(value: unknown): Promise<unknown> {
  if (
    isLazyProp(value) ||
    isAlwaysProp(value) ||
    isOptionalProp(value) ||
    isDeferProp(value) ||
    isMergeProp(value) ||
    isOnceProp(value)
  ) {
    return value.callback();
  }
  if (typeof value === "function") {
    return (value as () => unknown | Promise<unknown>)();
  }
  return value;
}

export const factory = new ResponseFactory();
