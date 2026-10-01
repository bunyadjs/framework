import { getUrlContext, Route, type Router } from "@bunyad/router";
import {
  factory,
  FLASH_KEY,
  InertiaResponse,
  resetInertiaState,
  ResponseFactory,
  type SharedPropValue,
  type VersionValue,
} from "./factory.ts";
import type { Request } from "@bunyad/http";
import {
  AlwaysProp,
  DeferProp,
  LazyProp,
  MergeProp,
  OnceProp,
  OptionalProp,
  ScrollProp,
  type PropResolver,
  type ScrollPaginator,
} from "./props.ts";
import type { PageName, PagePropsArgs } from "./pages.ts";
import type { SsrOptions } from "./ssr.ts";

function share(key: string, value: SharedPropValue): ResponseFactory;
function share(data: Record<string, SharedPropValue>): ResponseFactory;
function share(
  keyOrData: string | Record<string, SharedPropValue>,
  value?: SharedPropValue,
): ResponseFactory {
  if (typeof keyOrData === "string") return factory.share(keyOrData, value);
  return factory.share(keyOrData);
}

/**
 * `Inertia` facade — render pages, share props, asset versioning.
 */
export const Inertia = {
  /**
   * A GET route that renders `component` with fixed props — the page needs
   * no controller (`Route::inertia` in other frameworks).
   */
  route<N extends PageName>(uri: string, component: N, ...[props]: PagePropsArgs<N>): ReturnType<Router["get"]> {
    const data = { ...(props as Record<string, unknown> | undefined) };
    const registrar = Route.get(uri, inertiaPage(component, data));
    // Described as data so `bunyad compile` can register the page again.
    Route.routes.at(-1)!.declaration = { kind: "handler", module: "@bunyad/inertia", export: "inertiaPage", args: [component, data] };
    return registrar;
  },

  /** Render page `component`. With generated page types, the name and props are checked. */
  render<N extends PageName>(component: N, ...[props]: PagePropsArgs<N>): InertiaResponse {
    return factory.render(component, (props ?? {}) as Record<string, unknown>);
  },

  share,

  getShared(key?: string): unknown {
    return factory.getShared(key);
  },

  flushShared(): ResponseFactory {
    return factory.flushShared();
  },

  version(value: VersionValue): ResponseFactory {
    return factory.version(value);
  },

  getVersion(): string | null {
    return factory.getVersion();
  },

  setRootView(name: string): ResponseFactory {
    return factory.setRootView(name);
  },

  getRootView(): string {
    return factory.getRootView();
  },

  location(url: string): Response {
    return factory.location(url);
  },

  lazy(callback: PropResolver): LazyProp {
    return factory.lazy(callback);
  },

  optional(callback: PropResolver): OptionalProp {
    return factory.optional(callback);
  },

  defer(callback: PropResolver, group?: string | null): DeferProp {
    return factory.defer(callback, group);
  },

  always(callback: PropResolver): AlwaysProp {
    return factory.always(callback);
  },

  encryptHistory(value = true): ResponseFactory {
    return factory.encryptHistory(value);
  },

  /**
   * A prop a partial reload adds to instead of replacing: `Inertia.merge(() => items)`,
   * `.prepend()`, `.matchOn("id")` to replace rows by id.
   */
  merge(callback: PropResolver): MergeProp {
    return new MergeProp(callback);
  },

  /** Like `merge`, through nested objects and arrays. */
  deepMerge(callback: PropResolver): MergeProp {
    return new MergeProp(callback, true);
  },

  /** Resolved once and kept by the client across visits: `.as("plans")`, `.until(3600)`. */
  once(callback: PropResolver): OnceProp {
    return new OnceProp(callback);
  },

  /**
   * A paginated prop for `<InfiniteScroll>`: `Inertia.scroll(() => Post.query().paginate(20))`.
   * Each page is merged into the rows the client has (`data`, or `wrapper`).
   */
  scroll(callback: () => ScrollPaginator | Promise<ScrollPaginator>, wrapper = "data"): ScrollProp {
    return new ScrollProp(callback, wrapper);
  },

  /**
   * Data for the next page only, as the page's `flash` (not a prop): a toast
   * after a redirect. `router.on("flash", …)` sees it in the browser.
   */
  flash(key: string | Record<string, unknown>, value?: unknown): void {
    const session = getUrlContext().request?.session;
    if (!session) throw new Error("Inertia.flash() needs a request with a session.");
    const values = typeof key === "string" ? { [key]: value } : key;
    session.flash(FLASH_KEY, { ...session.get<Record<string, unknown>>(FLASH_KEY, {}), ...values });
  },

  /** Configure the SSR gateway (`enabled`, `url`, `timeout`, `except`). */
  ssr(options: SsrOptions): ResponseFactory {
    return factory.ssr(options);
  },
};

/** The action behind `Inertia.route`: render `component` with fixed props. */
export function inertiaPage(component: string, props: Record<string, unknown> = {}): () => InertiaResponse {
  return () => factory.render(component, { ...props });
}

/**
 * `inertia('Dashboard', props)` helper.
 * Call with no args to access the factory (`inertia().share(...)`).
 */
export function inertia(): ResponseFactory;
export function inertia<N extends PageName>(component: N, ...props: PagePropsArgs<N>): InertiaResponse;
export function inertia(
  component?: string,
  props: Record<string, unknown> = {},
): ResponseFactory | InertiaResponse {
  if (component === undefined) return factory;
  return factory.render(component, props);
}

/** Resolve an InertiaResponse (or pass-through Response) for the kernel. */
export async function resolveInertiaResponse(
  result: Response | InertiaResponse | Promise<Response | InertiaResponse>,
  request: Request,
): Promise<Response> {
  const value = await result;
  if (value instanceof InertiaResponse) return value.toResponse(request);
  return value;
}

export { resetInertiaState, ResponseFactory, InertiaResponse, factory };
export type { SharedPropValue, VersionValue };
