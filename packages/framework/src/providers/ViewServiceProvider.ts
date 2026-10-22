import { BunyadError } from "@bunyad/common";
import { ServiceProvider, isCompiledBootMode } from "@bunyad/core";
import { setMailViewRenderer } from "@bunyad/mail";
import {
  ViewFactory,
  setViewFactory,
  getViewFactory,
  render,
  takePreloadedViews,
  type ViewRenderer,
} from "@bunyad/view";
import { existsSync } from "node:fs";
import { getUrlContext, pageName, setPageResponder } from "@bunyad/router";
import { discoverViewComponents } from "../discovery.ts";

export class ViewServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    // Views sit beside their controllers in `routes/` unless the app keeps them in `resources/views`.
    const treePath = this.app.basePath("routes");
    const besideControllers = !existsSync(this.app.resourcePath("views")) && existsSync(treePath);
    const viewsPath = besideControllers ? treePath : this.app.resourcePath("views");
    const compiledViewsPath = this.app.basePath(".build/views/index.js");
    let compiled: Record<string, ViewRenderer> | undefined;
    let compiledOnly = false;

    const preloaded = takePreloadedViews();
    if (preloaded) {
      // Binary / `setPreloadedViews` embeds — never fall back to disk compile.
      compiled = preloaded;
      compiledOnly = true;
    } else if (isCompiledBootMode(this.app.basePath())) {
      // Production / `BUNYAD_COMPILED=1`: fail-fast if `.build/views` is missing.
      compiledOnly = true;
      if (!(await Bun.file(compiledViewsPath).exists())) {
        throw new BunyadError(
          `Compiled views missing at ${compiledViewsPath}. Run \`bunyad compile\` before production/compiled boot.`,
          "BUNYAD_VIEW_003",
        );
      }
      try {
        const mod = (await import(compiledViewsPath)) as {
          views?: Record<string, ViewRenderer>;
        };
        compiled = mod.views;
      } catch {
        throw new BunyadError(
          `Failed to load compiled views from ${compiledViewsPath}.`,
          "BUNYAD_VIEW_003",
        );
      }
      if (!compiled) {
        throw new BunyadError(
          `Compiled views module at ${compiledViewsPath} did not export \`views\`.`,
          "BUNYAD_VIEW_003",
        );
      }
    } else if (
      process.env.BUNYAD_DEV !== "1" &&
      process.env.BUNYAD_HOT !== "1" &&
      (await Bun.file(compiledViewsPath).exists())
    ) {
      // Opportunistic: use precompiled when present, still allow disk fallback.
      try {
        const mod = (await import(compiledViewsPath)) as {
          views?: Record<string, ViewRenderer>;
        };
        compiled = mod.views;
      } catch {
        compiled = undefined;
      }
    }

    const factory = new ViewFactory(viewsPath, {
      ...(compiled ? { compiled } : {}),
      ...(compiledOnly ? { compiledOnly: true } : {}),
      ...(besideControllers ? { componentsFolder: "_components" } : {}),
    });
    // Flashed validation errors and old input reach every view.
    factory.shareUsing(() => {
      const session = getUrlContext().request?.session;
      if (!session) return {};
      return {
        errors: session.get("errors", {}),
        _old: session.get("_old") ?? session.get("_old_input", {}),
      };
    });
    setViewFactory(factory);
    setMailViewRenderer((name, data) => render(name, data));
    const { setRouteViewRenderer } = await import("@bunyad/router");
    const { view } = await import("@bunyad/view");
    setRouteViewRenderer((name, data, status) => view(name, data ?? {}, status));
    if (besideControllers) registerViewPages();
    await discoverViewComponents(this.app);
  }
}

/**
 * A `*Page.view` beside its controller is the view of the action. It renders inside the
 * `*Layout.view` of each folder from `routes/` down, outermost first.
 */
function registerViewPages(): void {
  setPageResponder([".view"], (page, props) => {
    const factory = getViewFactory();
    const name = pageName(page.file).replaceAll("/", ".");
    const html = factory.renderPage(name, factory.layoutsFor(name), props);
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  });
}
