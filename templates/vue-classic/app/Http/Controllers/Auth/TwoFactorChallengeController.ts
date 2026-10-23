import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, TwoFactor } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import { Inertia } from "@bunyad/inertia";
import User from "@/Models/User.ts";

/** Second step of login for users with two-factor authentication on. */
export default class TwoFactorChallengeController {
  async create(request: Request) {
    if (!(await this.challengedUser(request))) return redirect(route("login"));

    return Inertia.render("auth/two-factor-challenge");
  }

  async store(request: Request) {
    const user = await this.challengedUser(request);
    if (!user) return redirect(route("login"));

    const { code, recovery_code } = await request.validate({
      code: "nullable|string",
      recovery_code: "nullable|string",
    });

    const passed = recovery_code
      ? await TwoFactor.useRecoveryCode(user, String(recovery_code))
      : await TwoFactor.verify(user, String(code ?? ""));

    if (!passed) {
      const field = recovery_code ? "recovery_code" : "code";
      throw ValidationException.withMessages({
        [field]: recovery_code
          ? "The provided two factor recovery code was invalid."
          : "The provided two factor authentication code was invalid.",
      });
    }

    const remember = Boolean(request.session!.get("login.remember"));
    request.session!.forget("login.id");
    request.session!.forget("login.remember");
    await Auth.login(request, user, remember);

    return redirect().intended(route("dashboard"));
  }

  /** The user who passed the password step, if any. */
  async challengedUser(request: Request): Promise<User | null> {
    const id = request.session?.get<string | number>("login.id");
    if (id === undefined) return null;
    const user = await User.find(id);
    return user?.hasEnabledTwoFactorAuthentication() ? user : null;
  }
}
