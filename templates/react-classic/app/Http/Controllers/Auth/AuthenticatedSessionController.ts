import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { Inertia } from "@bunyad/inertia";
import LoginRequest from "@/Http/Requests/Auth/LoginRequest.ts";

export default class AuthenticatedSessionController {
  create() {
    return Inertia.render("auth/login");
  }

  async store(request: LoginRequest) {
    const user = await request.validateCredentials();
    const remember = request.boolean("remember");

    // Hold the user in the session until they enter their authenticator code.
    if (user.hasEnabledTwoFactorAuthentication()) {
      request.session!.put("login.id", user.id);
      request.session!.put("login.remember", remember);
      return redirect(route("two-factor.login"));
    }

    await Auth.login(request, user, remember);

    return redirect().intended(route("dashboard"));
  }

  async destroy(request: Request) {
    await Auth.logout(request);

    return redirect("/");
  }
}
