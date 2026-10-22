import type { Request } from "@bunyad/http";
import { Method, redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";

@Method("POST")
export default class LogoutController {
  async handle(request: Request) {
    await Auth().logout(request);
    return redirect("/login");
  }
}
