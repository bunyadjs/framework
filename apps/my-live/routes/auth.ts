import { Live } from "@bunyad/live";
import { Route } from "@bunyad/router";
import LogoutController from "@/Http/Controllers/Auth/LogoutController.ts";
import VerifyEmailController from "@/Http/Controllers/Auth/VerifyEmailController.ts";

/** Sign up, log in, two-factor challenge, password reset, email verification, and password confirmation. */
export default function (): void {
  Route.middleware("guest").group(() => {
    Live.route("/register", "auth.register").name("register");
    Live.route("/login", "auth.login").name("login");
    Live.route("/two-factor-challenge", "auth.two-factor-challenge").name("two-factor.login");
    Live.route("/forgot-password", "auth.forgot-password").name("password.request");
    Live.route("/reset-password/{token}", "auth.reset-password").name("password.reset");
  });

  Route.middleware("auth").group(() => {
    Live.route("/email/verify", "auth.verify-email").name("verification.notice");

    Route.get("/email/verify/{id}/{hash}", VerifyEmailController)
      .middleware("signed", "throttle:6,1")
      .name("verification.verify");

    Live.route("/confirm-password", "auth.confirm-password").name("password.confirm");

    Route.post("/logout", LogoutController).name("logout");
  });
}
