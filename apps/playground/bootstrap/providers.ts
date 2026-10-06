import type { Application } from "@bunyad/core";
import { DebugbarServiceProvider } from "@bunyad/debugbar";
import AppServiceProvider from "../app/Providers/AppServiceProvider.ts";

/**
 * Application providers only (`bootstrap/providers.php` analogue).
 * Framework providers are registered via `bootFrameworkProviders`.
 */
export function registerProviders(app: Application): void {
  // Development only: self-disables in production, tests and console.
  app.register(DebugbarServiceProvider);
  app.register(AppServiceProvider);
}
