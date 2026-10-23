import { bunyad } from "@bunyad/framework";
import { verifyCsrf } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";

// `web` routes get the session, the current URL (for `back()` and `request()`), and CSRF checks.
export const createApplication = bunyad(import.meta, {
  groups: { web: [startSession(), handleUrl(), verifyCsrf()] },
});
