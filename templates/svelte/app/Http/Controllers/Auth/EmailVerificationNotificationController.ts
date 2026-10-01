import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { isMustVerifyEmail, sendEmailVerificationNotification } from "@bunyad/auth";
import { route } from "@bunyad/router";

export default class EmailVerificationNotificationController {
  async store(request: Request) {
    const user = request.user;
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      return redirect().intended(route("dashboard"));
    }

    await sendEmailVerificationNotification(user);

    return redirect().back().with("status", "verification-link-sent");
  }
}
