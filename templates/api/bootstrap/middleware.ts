import type { Application } from "@bunyad/core";

/** Default `api` middleware group (empty stack; extend as needed). */
export function registerMiddleware(app: Application): void {
  app.middlewareGroup("api", []);
}
