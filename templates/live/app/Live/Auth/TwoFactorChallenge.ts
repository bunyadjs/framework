import { Auth, TwoFactor } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import User from "@/Models/User.ts";
import { intendedUrl } from "@/Support/auth.ts";

/** Second step of login for users with two-factor authentication on. */
export default class TwoFactorChallenge extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Two-factor authentication";

  code = "";
  recovery_code = "";
  usingRecoveryCode = false;

  async mount(): Promise<void> {
    if (!(await this.#challengedUser())) this.redirect(route("login"));
  }

  toggleRecovery(): void {
    this.usingRecoveryCode = !this.usingRecoveryCode;
    this.code = "";
    this.recovery_code = "";
    this.resetErrorBag();
  }

  async verify(): Promise<void> {
    const user = await this.#challengedUser();
    if (!user) {
      this.navigate(route("login"));
      return;
    }

    const passed = this.usingRecoveryCode
      ? await TwoFactor.useRecoveryCode(user, this.recovery_code)
      : await TwoFactor.verify(user, this.code);

    if (!passed) {
      throw ValidationException.withMessages(
        this.usingRecoveryCode
          ? { recovery_code: "The provided two factor recovery code was invalid." }
          : { code: "The provided two factor authentication code was invalid." },
      );
    }

    const session = request().session!;
    const remember = Boolean(session.get("login.remember"));
    session.forget("login.id");
    session.forget("login.remember");
    await Auth.login(request(), user, remember);

    this.navigate(intendedUrl(route("dashboard")));
  }

  /** The user who passed the password step, if any. */
  async #challengedUser(): Promise<User | null> {
    const id = request().session?.get<string | number>("login.id");
    if (id === undefined) return null;
    const user = await User.find(id);
    return user?.hasEnabledTwoFactorAuthentication() ? user : null;
  }

  view(): string {
    return "live.auth.two-factor-challenge";
  }
}
