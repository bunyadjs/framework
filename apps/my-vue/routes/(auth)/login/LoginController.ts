import { redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import { route } from "@bunyad/router";
import LoginRequest from "./LoginRequest.ts";

/** The password step of login. Users with two-factor on go on to `two-factor-challenge`. View: `LoginPage.tsx`. */
export default class LoginController {
  async store(request: LoginRequest) {
    const user = await request.validateCredentials();
    const remember = request.boolean("remember");

    // Hold the user in the session until they enter their authenticator code.
    if (user.hasEnabledTwoFactorAuthentication()) {
      request.session!.put("login.id", user.id);
      request.session!.put("login.remember", remember);
      return redirect(route("two-factor-challenge"));
    }

    await Auth.login(request, user, remember);

    return redirect().intended(route("dashboard"));
  }
}
