import { Password } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";

export default class ForgotPassword extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Forgot password";

  email = "";
  status = "";

  /** Always answers the same way, so the form does not reveal which emails have accounts. */
  async sendPasswordResetLink(): Promise<void> {
    await this.validate({ email: "required|email" });

    await Password.sendResetLink({ email: this.email });

    this.status = "A reset link will be sent if the account exists.";
  }

  view(): string {
    return "live.auth.forgot-password";
  }
}
