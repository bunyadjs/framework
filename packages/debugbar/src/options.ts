import type { Application } from "@bunyad/core";
import { MemoryDebugbarStore } from "./store.ts";
import type { DebugbarOptions, ResolvedDebugbarOptions } from "./types.ts";

export function resolveOptions(options: DebugbarOptions = {}): ResolvedDebugbarOptions {
  const history = options.history ?? 50;
  return {
    enabled: options.enabled,
    path: (options.path ?? "/_debugbar").replace(/\/+$/, "") || "/_debugbar",
    history,
    slowQueryMs: options.slowQueryMs ?? 100,
    nPlusOneThreshold: options.nPlusOneThreshold ?? 5,
    queryOrigin: options.queryOrigin ?? true,
    maxRecords: options.maxRecords ?? 500,
    except: options.except ?? [],
    redact: options.redact ?? [],
    inject: options.inject ?? true,
    store: options.store ?? new MemoryDebugbarStore(history),
  };
}

/**
 * Explicit `enabled` (option, `debugbar.enabled` config, or `DEBUGBAR` env) wins.
 * Otherwise: debug mode on, and not production or unit tests.
 */
export function isDebugbarEnabled(
  app: Application,
  options: Pick<ResolvedDebugbarOptions, "enabled">,
): boolean {
  if (typeof options.enabled === "boolean") return options.enabled;

  const configured = app.config.get("debugbar.enabled");
  if (typeof configured === "boolean") return configured;

  const env = process.env.DEBUGBAR;
  if (env === "false" || env === "0") return false;
  if (env === "true" || env === "1") return true;

  return (
    app.hasDebugModeEnabled() && !app.isProduction() && !app.runningUnitTests()
  );
}
