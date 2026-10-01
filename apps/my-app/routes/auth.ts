import { Route } from "@bunyad/router";
import AuthenticatedSessionController from "@/Http/Controllers/Auth/AuthenticatedSessionController.ts";
import ConfirmablePasswordController from "@/Http/Controllers/Auth/ConfirmablePasswordController.ts";
import EmailVerificationNotificationController from "@/Http/Controllers/Auth/EmailVerificationNotificationController.ts";
import EmailVerificationPromptController from "@/Http/Controllers/Auth/EmailVerificationPromptController.ts";
import NewPasswordController from "@/Http/Controllers/Auth/NewPasswordController.ts";
import PasswordResetLinkController from "@/Http/Controllers/Auth/PasswordResetLinkController.ts";
import RegisteredUserController from "@/Http/Controllers/Auth/RegisteredUserController.ts";
import TwoFactorChallengeController from "@/Http/Controllers/Auth/TwoFactorChallengeController.ts";
import VerifyEmailController from "@/Http/Controllers/Auth/VerifyEmailController.ts";

/** Sign up, log in, two-factor challenge, password reset, email verification, and password confirmation. */
export default function (): void {
  Route.middleware("guest").group(() => {
    Route.get("/register", [RegisteredUserController, "create"]).name("register");
    Route.post("/register", [RegisteredUserController, "store"]).name("register.store");

    Route.get("/login", [AuthenticatedSessionController, "create"]).name("login");
    Route.post("/login", [AuthenticatedSessionController, "store"]).name("login.store");

    Route.get("/two-factor-challenge", [TwoFactorChallengeController, "create"]).name("two-factor.login");
    Route.post("/two-factor-challenge", [TwoFactorChallengeController, "store"])
      .middleware("throttle:5,1")
      .name("two-factor.login.store");

    Route.get("/forgot-password", [PasswordResetLinkController, "create"]).name("password.request");
    Route.post("/forgot-password", [PasswordResetLinkController, "store"]).name("password.email");

    Route.get("/reset-password/{token}", [NewPasswordController, "create"]).name("password.reset");
    Route.post("/reset-password", [NewPasswordController, "store"]).name("password.store");
  });

  Route.middleware("auth").group(() => {
    Route.get("/email/verify", EmailVerificationPromptController).name("verification.notice");

    Route.get("/email/verify/{id}/{hash}", VerifyEmailController)
      .middleware("signed", "throttle:6,1")
      .name("verification.verify");

    Route.post("/email/verification-notification", [EmailVerificationNotificationController, "store"])
      .middleware("throttle:6,1")
      .name("verification.send");

    Route.get("/confirm-password", [ConfirmablePasswordController, "show"]).name("password.confirm");
    Route.post("/confirm-password", [ConfirmablePasswordController, "store"]).name("password.confirm.store");

    Route.post("/logout", [AuthenticatedSessionController, "destroy"]).name("logout");
  });
}
