import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { isMustVerifyEmail } from "@bunyad/auth";
import { route } from "@bunyad/router";

/** The notice that asks a new user to verify their email. View: `VerifyEmailPage.tsx`. The mail's link and the resend button are in `AuthController`. */
export default class VerifyEmailController {
  /** Verified users skip the notice. */
  show(request: Request) {
    const user = request.user;
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      return redirect().intended(route("dashboard"));
    }
  }
}
