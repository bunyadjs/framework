import type { Request } from "@bunyad/http";
import { Get, Post, redirect } from "@bunyad/http";
import { Auth, fulfillEmailVerification } from "@bunyad/auth";
import { route } from "@bunyad/router";

/** The actions of the sign-in pages that are not Live components. */
export default class AuthController {
  @Post("/logout", { name: "logout" })
  async logout(request: Request) {
    await Auth.logout(request);

    return redirect("/");
  }

  /** Signed link from the verification mail. */
  @Get("/email/verify/{id}/{hash}", { name: "verification.verify" })
  async verifyEmail(request: Request) {
    await fulfillEmailVerification(request);

    return redirect().intended(`${route("dashboard")}?verified=1`);
  }
}
