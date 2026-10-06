import { ServiceProvider, registerProviderCommand } from "@bunyad/core";
import { installCollectors } from "./collectors/install.ts";
import { registerDebugbarTools } from "./mcp-tools.ts";
import { DebugbarMiddleware } from "./middleware.ts";
import { isDebugbarEnabled, resolveOptions } from "./options.ts";
import { setActiveDebugbar } from "./state.ts";
import type { DebugbarOptions, ResolvedDebugbarOptions } from "./types.ts";

/** Register with `app.register(DebugbarServiceProvider)`; configure under `debugbar` config. */
export class DebugbarServiceProvider extends ServiceProvider {
  #dispose?: () => void;

  register(): void {
    const configured = this.app.config.get("debugbar") as DebugbarOptions | undefined;
    const options = resolveOptions(configured ?? {}, this.app.basePath());
    this.app.instance("debugbar.options", options);

    registerProviderCommand("debugbar:clear", async () => {
      await options.store.clear();
      console.log("Debugbar history cleared.");
    });
  }

  boot(): void {
    const options = this.app.make<ResolvedDebugbarOptions>("debugbar.options");
    if (!isDebugbarEnabled(this.app, options)) {
      setActiveDebugbar(undefined);
      return;
    }

    this.#dispose?.();
    this.#dispose = installCollectors(options);
    setActiveDebugbar(options);
    registerDebugbarTools(() => options.store);

    const middleware = new DebugbarMiddleware(options);
    const existing = this.app.getMiddleware();
    if (!existing.some((layer) => layer instanceof DebugbarMiddleware)) {
      this.app.middleware([middleware, ...existing]);
    }
  }
}
