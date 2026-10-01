import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { fulfillEmailVerification } from "@bunyad/auth";
import { route } from "@bunyad/router";

export default class VerifyEmailController {
  /** Signed link from the verification mail. */
  async __invoke(request: Request) {
    await fulfillEmailVerification(request);

    return redirect().intended(`${route("dashboard")}?verified=1`);
  }
}
