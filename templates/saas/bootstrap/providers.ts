import type { Application } from "@bunyad/core";
import AppServiceProvider from "../app/Providers/AppServiceProvider.ts";

export function registerProviders(app: Application): void {
  app.register(AppServiceProvider);
}
