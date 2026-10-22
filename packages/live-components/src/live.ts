import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Route, setLivePageHandler, type Router } from "@bunyad/router";
import { getViewFactory, view } from "@bunyad/view";
import {
  clearLiveComponents,
  listLiveComponents,
  mountLive,
  mountLiveResult,
  registerLiveComponent,
  resolveLiveComponent,
  updateLive,
  type LiveComponentClass,
} from "./component.ts";
import LiveController, {
  configureLiveHttp,
} from "./http-controller.ts";
import type { LiveUpdatePayload } from "./snapshot.ts";

export type LiveRoutesOptions = {
  /** Update endpoint path (default `/live/update`). */
  updatePath?: string;
  /** Client script path (default `/live/live.js`). */
  scriptPath?: string;
};

/**
 * Live-component facade for Bunyad.
 */
export const Live = {
  component(name: string, Ctor: LiveComponentClass): void {
    registerLiveComponent(name, Ctor);
  },

  resolve: resolveLiveComponent,
  components: listLiveComponents,
  clear: clearLiveComponents,

  /** Initial HTML for embedding a component in a page. */
  async mount(
    name: string,
    props: Record<string, unknown> = {},
  ): Promise<string> {
    return mountLive(name, props);
  },

  /** Process a client update request body. */
  async update(payload: LiveUpdatePayload) {
    return updateLive(payload);
  },

  /**
   * Full-page component: a GET route that mounts `name` with the route
   * parameters and renders it inside the component's `static layout`
   * (default `layouts.app`) as `slot`, with its `static title`. A
   * `redirect()` or `navigate()` from `mount()` becomes an HTTP redirect.
   */
  route(uri: string, name: string): ReturnType<Router["get"]> {
    const registrar = Route.get(uri, livePage(name));
    // Described as data so `bunyad compile` can register the page again.
    Route.routes.at(-1)!.declaration = { kind: "handler", module: "@bunyad/live-components", export: "livePage", args: [name] };
    return registrar;
  },

  /** Register update + script routes on a router. */
  routes(router: Router, options: LiveRoutesOptions = {}): void {
    const updatePath = options.updatePath ?? "/live/update";
    const scriptPath = options.scriptPath ?? "/live/live.js";
    configureLiveHttp({ updatePath });

    router
      .get(scriptPath, [LiveController, "script"])
      .name("live.script");
    router
      .post(updatePath, [LiveController, "update"])
      .name("live.update");
  },

  /** Script tag pointing at the Live client. */
  scripts(scriptPath = "/live/live.js"): string {
    return `<script src="${scriptPath}" defer></script>`;
  },
};

/** The action behind `Live.route`: mount component `name` as a full page. */
export function livePage(name: string): (request: Request) => Promise<Response> {
  return async (request) => {
    const Ctor = resolveLiveComponent(name);
    const params = request.route();
    const { html, effects } = await mountLiveResult(name, params);
    // On the first page load, redirect() and navigate() from mount() both redirect.
    const target = effects.redirect ?? effects.navigate;
    if (target) return redirect(target);
    // A component in a route folder renders inside the `*Layout.view` of its folders, as `children`.
    const factory = getViewFactory();
    const layouts = Ctor.layout ? [] : factory.layoutsFor(name);
    if (layouts.length > 0) {
      const page = factory.wrapInLayouts(layouts, html, Ctor.meta ?? { title: Ctor.title }, {});
      return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return view(Ctor.layout ?? "layouts.app", { title: Ctor.title, slot: html });
  };
}

// Components in route folders (`LoginLive.ts`) are served by `livePage`.
setLivePageHandler((name) => livePage(name), (router) => Live.routes(router));

export { LiveController, configureLiveHttp };
