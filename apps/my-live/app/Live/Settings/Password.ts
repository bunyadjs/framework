import { Hash } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";
import { currentUser } from "@/Support/auth.ts";

export default class Password extends LiveComponent {
  static title = "Password settings";

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
    return "live.settings.password";
  }
}
