import type { Application } from "@bunyad/core";
import { verifyCsrf } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";

/** `web` routes get the session, the current URL (for `back()` and `request()`), and CSRF checks. */
export function registerMiddleware(app: Application): void {
  app.middlewareGroup("web", [startSession(), handleUrl(), verifyCsrf()]);
  app.middlewareGroup("api", []);
}
