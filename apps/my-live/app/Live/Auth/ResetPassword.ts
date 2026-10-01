import { Password, PasswordReset } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { LiveComponent } from "@bunyad/live";
import { route } from "@bunyad/router";
import type User from "@/Models/User.ts";

const failures: Record<string, string> = {
  [Password.InvalidToken]: "This password reset link is invalid or has expired.",
  [Password.InvalidUser]: "We can't find a user with that email address.",
};

export default class ResetPassword extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Reset password";

  token = "";
  email = "";
  password = "";
  password_confirmation = "";

  /** `token` comes from the route; the email from `?email=`. */
  mount(): void {
    this.email = request().query().email ?? "";
  }

  async resetPassword(): Promise<void> {
    await this.validate({
      token: "required",
      email: "required|email",
      password: "required|string|confirmed|min:8",
    });

    const status = await Password.reset(
      { email: this.email, password: this.password, token: this.token },
      async (user) => {
        const model = user as User;
        model.password = this.password;
        // Signs out every "remember me" device.
        model.remember_token = null;
        await model.save();
        await event(new PasswordReset(model));
      },
    );

    if (status !== Password.PasswordReset) {
      this.addError("email", failures[status] ?? "Unable to reset your password.");
      return;
    }

    request().session!.flash("status", "Your password has been reset.");
    this.navigate(route("login"));
  }

  view(): string {
    return "live.auth.reset-password";
  }
}
