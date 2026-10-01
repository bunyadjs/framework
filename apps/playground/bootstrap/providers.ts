import type { Application } from "@bunyad/core";
import AppServiceProvider from "../app/Providers/AppServiceProvider.ts";

/**
 * Application providers only (`bootstrap/providers.php` analogue).
 * Framework providers are registered via `bootFrameworkProviders`.
 */
export function registerProviders(app: Application): void {
  app.register(AppServiceProvider);
}
