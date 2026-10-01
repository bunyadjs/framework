import { TwoFactor as TwoFactorAuth } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";
import { ValidationException } from "@bunyad/validation";
import { getViewFactory } from "@bunyad/view";
import { currentUser, ensurePasswordConfirmed } from "@/Support/auth.ts";

/**
 * Settings → Two-factor. Enabling stores a secret and shows the QR code;
 * two-factor is on once the user confirms a code from their app. The route
 * sits behind `password.confirm`, and every action checks it again.
 */
export default class TwoFactor extends LiveComponent {
  static title = "Two-factor authentication";

  code = "";
  status = "";

  async enable(): Promise<void> {
    ensurePasswordConfirmed();
    await TwoFactorAuth.enable(await currentUser());
    this.status = "";
  }

  async confirm(): Promise<void> {
    ensurePasswordConfirmed();
    const user = await currentUser();
    const code = this.code;
    this.code = "";
    if (!(await TwoFactorAuth.confirm(user, code))) {
      throw ValidationException.withMessages({
        code: "The provided two factor authentication code was invalid.",
      });
    }
    this.status = "two-factor-confirmed";
  }

  async disable(): Promise<void> {
    ensurePasswordConfirmed();
    await TwoFactorAuth.disable(await currentUser());
    this.status = "two-factor-disabled";
  }

  async regenerateRecoveryCodes(): Promise<void> {
    ensurePasswordConfirmed();
    await TwoFactorAuth.regenerateRecoveryCodes(await currentUser());
    this.status = "recovery-codes-generated";
  }

  /**
   * The QR code, setup key, and recovery codes are read from the user on
   * each render instead of kept as public state, so they never enter the
   * snapshot the browser holds.
   */
  async html(): Promise<string> {
    const user = await currentUser();
    const enabled = user.hasEnabledTwoFactorAuthentication();
    const pending = Boolean(user.two_factor_secret) && !enabled;

    return getViewFactory().render("live.settings.two-factor", {
      ...this.data(),
      errors: this.getErrorBag(),
      enabled,
      pending,
      qrCodeSvg: pending ? user.twoFactorQrCodeSvg() : null,
      setupKey: pending ? user.twoFactorSecret() : null,
      recoveryCodes: user.two_factor_secret ? user.recoveryCodes() : [],
    });
  }
}
