import type { Request } from "@bunyad/http";
import { Get, Middleware, Post, redirect } from "@bunyad/http";
import { Auth, fulfillEmailVerification, isMustVerifyEmail, sendEmailVerificationNotification } from "@bunyad/auth";
import { route } from "@bunyad/router";

/**
 * The actions of the sign-in area that have no page, so they need no folder of their own.
 * Who may call them is in `auth.routes.ts`.
 */
export default class AuthController {
  /** The sign-out button in the layout posts here. */
  @Post("/logout", { name: "logout" })
  async logout(request: Request) {
    await Auth.logout(request);

    return redirect("/");
  }

  /** The resend button on `email/verify`. */
  @Post("/email/verification-notification", { name: "email.verification-notification.store" })
  @Middleware("throttle:6,1")
  async resendVerification(request: Request) {
    const user = request.user;
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      return redirect().intended(route("dashboard"));
    }

    await sendEmailVerificationNotification(user);

    return redirect().back().with("status", "verification-link-sent");
  }

  /** The signed link in the verification mail. */
  @Get("/email/verify/{id}/{hash}", { name: "verification.verify" })
  @Middleware("signed", "throttle:6,1")
  async confirmEmail(request: Request) {
    await fulfillEmailVerification(request);

    return redirect().intended(`${route("dashboard")}?verified=1`);
  }
}
