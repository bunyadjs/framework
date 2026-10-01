import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { TwoFactor } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import { Inertia } from "@bunyad/inertia";
import type User from "@/Models/User.ts";

/**
 * Settings → Two-factor. Enabling stores a secret and shows the QR code;
 * two-factor is on once the user confirms a code from their app.
 */
export default class TwoFactorController {
  show(request: Request) {
    const user = request.user as User;
    const pending = Boolean(user.two_factor_secret) && !user.hasEnabledTwoFactorAuthentication();

    return Inertia.render("settings/two-factor", {
      enabled: user.hasEnabledTwoFactorAuthentication(),
      pending,
      qrCodeSvg: pending ? user.twoFactorQrCodeSvg() : null,
      setupKey: pending ? user.twoFactorSecret() : null,
      recoveryCodes: user.two_factor_secret ? user.recoveryCodes() : [],
    });
  }

  async store(request: Request) {
    await TwoFactor.enable(request.user as User);

    return redirect(route("two-factor.show"));
  }

  async confirm(request: Request) {
    const { code } = await request.validate({ code: "required|string" });

    if (!(await TwoFactor.confirm(request.user as User, String(code)))) {
      throw ValidationException.withMessages({
        code: "The provided two factor authentication code was invalid.",
      });
    }

    return redirect(route("two-factor.show")).with("status", "two-factor-confirmed");
  }

  async destroy(request: Request) {
    await TwoFactor.disable(request.user as User);

    return redirect(route("two-factor.show")).with("status", "two-factor-disabled");
  }

  async regenerateRecoveryCodes(request: Request) {
    await TwoFactor.regenerateRecoveryCodes(request.user as User);

    return redirect(route("two-factor.show")).with("status", "recovery-codes-generated");
  }
}
