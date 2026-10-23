import type { Request } from "@bunyad/http";
import { Middleware, Name, Post, redirect } from "@bunyad/http";
import { TwoFactor } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import type User from "@/Models/User.ts";

/**
 * Turning two-factor on and off. Enabling stores a secret and shows the QR code; two-factor is on once the
 * user confirms a code from their app. Everything here asks for the password again. View: `TwoFactorPage.tsx`.
 */
@Middleware("password.confirm")
export default class TwoFactorController {
  @Name("two-factor.show")
  show(request: Request) {
    const user = request.user as User;
    const pending = Boolean(user.two_factor_secret) && !user.hasEnabledTwoFactorAuthentication();

    return {
      enabled: user.hasEnabledTwoFactorAuthentication(),
      pending,
      qrCodeSvg: pending ? user.twoFactorQrCodeSvg() : null,
      setupKey: pending ? user.twoFactorSecret() : null,
      recoveryCodes: user.two_factor_secret ? user.recoveryCodes() : [],
    };
  }

  @Name("two-factor.enable")
  async store(request: Request) {
    await TwoFactor.enable(request.user as User);

    return redirect(route("two-factor.show"));
  }

  @Post("/confirm", { name: "two-factor.confirm" })
  async confirm(request: Request) {
    const { code } = await request.validate({ code: "required|string" });

    if (!(await TwoFactor.confirm(request.user as User, String(code)))) {
      throw ValidationException.withMessages({
        code: "The provided two factor authentication code was invalid.",
      });
    }

    return redirect(route("two-factor.show")).with("status", "two-factor-confirmed");
  }

  @Name("two-factor.disable")
  async destroy(request: Request) {
    await TwoFactor.disable(request.user as User);

    return redirect(route("two-factor.show")).with("status", "two-factor-disabled");
  }

  @Post("/recovery-codes", { name: "two-factor.recovery-codes" })
  async regenerateRecoveryCodes(request: Request) {
    await TwoFactor.regenerateRecoveryCodes(request.user as User);

    return redirect(route("two-factor.show")).with("status", "recovery-codes-generated");
  }
}
