import { existsSync } from "node:fs";
import { ServiceProvider } from "@bunyad/core";
import { Inertia, type SsrMode } from "@bunyad/inertia";

export type InertiaSsrConfig = {
  enabled?: boolean;
  mode?: SsrMode;
  url?: string;
  timeout?: number;
};

export type InertiaConfig = {
  ssr?: InertiaSsrConfig;
};

/**
 * Configure Inertia SSR from `config/inertia.ts`.
 * Inline mode lazy-loads `bootstrap/inertia-ssr.tsx` once at boot.
 */
export class InertiaServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const config = this.app.config.get<InertiaConfig>("inertia");
    if (!config?.ssr) return;

    const ssr = config.ssr;
    const enabled = ssr.enabled ?? false;
    const mode: SsrMode = ssr.mode ?? "http";
    const url = ssr.url ?? "http://127.0.0.1:13714";
    const timeout = ssr.timeout ?? 3000;

    if (enabled && mode === "inline") {
      const entry = resolveSsrEntry(this.app);
      if (entry) {
        try {
          const mod = await import(entry);
          const render = mod.renderInertiaPage ?? mod.default;
          if (typeof render === "function") {
            Inertia.ssr({ enabled: true, mode: "inline", render, url, timeout });
            return;
          }
        } catch (error) {
          // A renderer that cannot load (a single binary without its page
          // modules) must not stop the app: pages render in the browser.
          console.warn(`  WARN  Inertia SSR is off, pages render in the browser: ${(error as Error).message}`);
          Inertia.ssr({ enabled: false, mode, url, timeout });
          return;
        }
      }
    }

    Inertia.ssr({ enabled, mode, url, timeout });
  }
}

function resolveSsrEntry(app: { bootstrapPath(path?: string): string }): string | null {
  const tsx = app.bootstrapPath("inertia-ssr.tsx");
  if (existsSync(tsx)) return tsx;
  const ts = app.bootstrapPath("inertia-ssr.ts");
  if (existsSync(ts)) return ts;
  return null;
}
