import { ViewFactory, type ViewRenderer } from "./factory.ts";

type ViewGlobal = typeof globalThis & {
  __bunyad_view_factory?: ViewFactory;
  __bunyad_preloaded_views?: Record<string, ViewRenderer>;
};

function store(): ViewGlobal {
  return globalThis as ViewGlobal;
}

export function setViewFactory(instance: ViewFactory): void {
  // globalThis survives `bun --hot` module identity churn so live reload
  // clears the same factory the request path renders with.
  store().__bunyad_view_factory = instance;
}

export function getViewFactory(): ViewFactory {
  return store().__bunyad_view_factory!;
}

/**
 * Register precompiled views before `ViewServiceProvider` boots
 * (used by `bunyad compile` / `--binary` so templates ship inside the executable).
 */
export function setPreloadedViews(
  views: Record<string, ViewRenderer>,
): void {
  store().__bunyad_preloaded_views = views;
}

/** Consume preloaded views (clears the slot). */
export function takePreloadedViews():
  | Record<string, ViewRenderer>
  | undefined {
  const views = store().__bunyad_preloaded_views;
  delete store().__bunyad_preloaded_views;
  return views;
}

type HeadGlobal = typeof globalThis & {
  __bunyad_head_renderer?: () => string;
};

/** Register the `@head` directive renderer (from `@bunyad/head`). */
export function setHeadRenderer(fn: (() => string) | null): void {
  (globalThis as HeadGlobal).__bunyad_head_renderer = fn ?? undefined;
}

/** Used by compiled `@head` directives. */
export function renderHead(): string {
  return (globalThis as HeadGlobal).__bunyad_head_renderer?.() ?? "";
}

/**
 * Render a named `.view` template to an HTML Response.
 */
export function view(
  name: string,
  data: Record<string, unknown> = {},
  status = 200,
): Response {
  const html = getViewFactory().render(name, data);
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Render to string (tests / mail). */
export function render(
  name: string,
  data: Record<string, unknown> = {},
): string {
  return getViewFactory().render(name, data);
}

/**
 * Facade over the bound view factory (`View.share`, `View.composer`, …).
 */
export const View = {
  share(key: string | Record<string, unknown>, value?: unknown) {
    return getViewFactory().share(key, value);
  },
  composer(
    views: string | string[],
    callback: (
      data: Record<string, unknown>,
      name: string,
    ) => void | Record<string, unknown>,
  ) {
    return getViewFactory().composer(views, callback);
  },
  exists(name: string): boolean {
    return getViewFactory().exists(name);
  },
  first(names: string[], data: Record<string, unknown> = {}): string {
    return getViewFactory().first(names, data);
  },
  render(name: string, data: Record<string, unknown> = {}): string {
    return getViewFactory().render(name, data);
  },
  make(name: string, data: Record<string, unknown> = {}): string {
    return getViewFactory().render(name, data);
  },
};
