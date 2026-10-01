import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";

export default class LogoutController {
  async __invoke(request: Request) {
    await Auth.logout(request);

    return redirect("/");
  }
}
