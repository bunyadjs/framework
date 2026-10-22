import { bunyad } from "@bunyad/framework";
import { verifyCsrf } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";
import HandleInertiaRequests from "@/Http/Middleware/HandleInertiaRequests.ts";

// `web` routes get the session, the current URL (for `back()`), CSRF checks, and Inertia.
export const createApplication = bunyad(import.meta, {
  groups: { web: [startSession(), handleUrl(), verifyCsrf(), new HandleInertiaRequests()] },
});
