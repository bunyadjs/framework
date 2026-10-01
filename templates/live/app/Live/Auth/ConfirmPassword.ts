import { Auth, markPasswordConfirmed } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import { currentUser, intendedUrl } from "@/Support/auth.ts";

export default class ConfirmPassword extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Confirm password";

  password = "";

  async confirmPassword(): Promise<void> {
    await this.validate({ password: "required|string" });
    const user = await currentUser();

    const valid = await Auth.validate({ email: user.email, password: this.password });
    this.password = "";
    if (!valid) {
      throw ValidationException.withMessages({ password: "The provided password is incorrect." });
    }

    await markPasswordConfirmed(request());
    this.navigate(intendedUrl(route("dashboard")));
  }

  view(): string {
    return "live.auth.confirm-password";
  }
}
