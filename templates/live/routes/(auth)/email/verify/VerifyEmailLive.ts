import { Auth, isMustVerifyEmail, sendEmailVerificationNotification } from "@bunyad/auth";
import { LiveComponent } from "@bunyad/live-components";
import { route } from "@bunyad/router";
import { currentUser, intendedUrl } from "@/Support/auth.ts";

export default class VerifyEmail extends LiveComponent {
  static title = "Verify email";
  static routeName = "email.verify";

  linkSent = false;

  async mount(): Promise<void> {
    const user = await currentUser();
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      this.redirect(intendedUrl(route("dashboard")));
    }
  }

  async sendVerification(): Promise<void> {
    const user = await currentUser();
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      this.navigate(intendedUrl(route("dashboard")));
      return;
    }

    await sendEmailVerificationNotification(user);
    this.linkSent = true;
  }

  async logout(): Promise<void> {
    await Auth.logout(request());
    this.redirect("/");
  }

  view(): string {
    return "(auth).email.verify.VerifyEmailPage";
  }
}
