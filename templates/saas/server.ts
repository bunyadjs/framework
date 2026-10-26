import { bunyad } from "@bunyad/framework";
import { optionalAuth, verifyCsrf } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";

import AppServiceProvider from "@/Providers/AppServiceProvider.ts";

// `web` routes get the session, the current URL (for `back()` and `request()`), and CSRF checks.
export const createApplication = bunyad(import.meta, {
  groups: { web: [startSession(), optionalAuth(), handleUrl(), verifyCsrf()] },
  providers: [AppServiceProvider],
});
