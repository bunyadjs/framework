import type { Application } from "@bunyad/core";
import { verifyCsrf } from "@bunyad/auth";
import { handleHead } from "@bunyad/head";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";
import HandleInertiaRequests from "../app/Http/Middleware/HandleInertiaRequests.ts";
import SetHeader from "../app/Http/Middleware/SetHeader.ts";

/**
 * middleware registration (`withMiddleware` / Kernel groups).
 * - Global: runs on every request
 * - `web` / `api`: applied via `Route.middleware("web"|"api")`
 */
export function registerMiddleware(app: Application): void {
  app.middleware([new SetHeader()]);

  app.middlewareGroup("web", [
    handleHead(),
    startSession(),
    handleUrl(),
    verifyCsrf(),
    new HandleInertiaRequests(),
  ]);

  // Bindings are resolved in the HTTP kernel.
  app.middlewareGroup("api", []);
}
