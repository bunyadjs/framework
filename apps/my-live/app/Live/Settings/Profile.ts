import { Auth, Hash, isMustVerifyEmail, sendEmailVerificationNotification } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live";
import { Rule } from "@bunyad/validation";
import { currentUser } from "@/Support/auth.ts";

export default class Profile extends LiveComponent {
  static title = "Profile settings";

  name = "";
  email = "";
  saved = false;
  mustVerifyEmail = false;
  verificationLinkSent = false;
  confirmingDeletion = false;
  deletePassword = "";

  async mount(): Promise<void> {
    const user = await currentUser();
    this.name = user.name;
    this.email = user.email;
    this.mustVerifyEmail = isMustVerifyEmail(user) && !user.hasVerifiedEmail();
  }

  async updateProfile(): Promise<void> {
    const user = await currentUser();
    this.saved = false;
    await this.validate({
      name: "required|string|max:255",
      email: ["required", "string", "lowercase", "email", "max:255", Rule.unique("users", "email").ignore(user.id)],
    });

    // A new address has to be verified again.
    if (this.email !== user.email) user.email_verified_at = null;
    user.name = this.name;
    user.email = this.email;
    await user.save();

    this.mustVerifyEmail = isMustVerifyEmail(user) && !user.hasVerifiedEmail();
    this.saved = true;
  }

  async resendVerification(): Promise<void> {
    const user = await currentUser();
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) return;
    await sendEmailVerificationNotification(user);
    this.verificationLinkSent = true;
  }

  confirmUserDeletion(): void {
    this.confirmingDeletion = true;
  }

  cancelUserDeletion(): void {
    this.confirmingDeletion = false;
    this.deletePassword = "";
    this.resetErrorBag("deletePassword");
  }

  async deleteUser(): Promise<void> {
    const user = await currentUser();
    const valid = await Hash.check(this.deletePassword, user.password!);
    this.deletePassword = "";
    if (!valid) {
      this.addError("deletePassword", "The password is incorrect.");
      return;
    }

    await Auth.logout(request());
    await user.delete();
    this.redirect("/");
  }

  view(): string {
    return "live.settings.profile";
  }
}
