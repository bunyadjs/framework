import { Hash } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live-components";
import { currentUser } from "@/Support/auth.ts";

export default class Password extends LiveComponent {
  static meta = { title: "Password settings", heading: "Update password", subheading: "Ensure your account is using a long, random password to stay secure" };
  static routeName = "settings.password";

  current_password = "";
  password = "";
  password_confirmation = "";
  saved = false;

  async updatePassword(): Promise<void> {
    const user = await currentUser();
    this.saved = false;
    try {
      await this.validate({
        current_password: "required|string",
        password: "required|string|confirmed|min:8",
      });
      if (!(await Hash.check(this.current_password, user.password!))) {
        this.addError("current_password", "The password is incorrect.");
        return;
      }

      user.password = this.password;
      await user.save();
      this.saved = true;
    } finally {
      this.current_password = "";
      this.password = "";
      this.password_confirmation = "";
    }
  }

  view(): string {
    return "(app).settings.password.PasswordPage";
  }
}
