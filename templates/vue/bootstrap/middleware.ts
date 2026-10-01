import type { Application } from "@bunyad/core";
import { verifyCsrf } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";
import HandleInertiaRequests from "@/Http/Middleware/HandleInertiaRequests.ts";

/** `web` routes get the session, the current URL (for `back()`), CSRF checks, and Inertia. */
export function registerMiddleware(app: Application): void {
  app.middlewareGroup("web", [startSession(), handleUrl(), verifyCsrf(), new HandleInertiaRequests()]);
  app.middlewareGroup("api", []);
}
