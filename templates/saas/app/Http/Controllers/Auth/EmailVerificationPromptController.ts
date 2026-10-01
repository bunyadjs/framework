import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { isMustVerifyEmail } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { view } from "@bunyad/view";

export default class EmailVerificationPromptController {
  __invoke(request: Request) {
    const user = request.user;
    if (!isMustVerifyEmail(user) || user.hasVerifiedEmail()) {
      return redirect().intended(route("dashboard"));
    }

    return view("auth.verify-email", { title: "Verify email" });
  }
}
