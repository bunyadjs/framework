import { BunyadError } from "@bunyad/common";
import { ServiceProvider, isCompiledBootMode } from "@bunyad/core";
import { setMailViewRenderer } from "@bunyad/mail";
import {
  ViewFactory,
  setViewFactory,
  render,
  takePreloadedViews,
  type ViewRenderer,
} from "@bunyad/view";
import { getUrlContext } from "@bunyad/router";
import { discoverViewComponents } from "../discovery.ts";

export class ViewServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const viewsPath = this.app.resourcePath("views");
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
    await discoverViewComponents(this.app);
  }
}
