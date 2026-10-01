import { Auth, loginThrottleKey } from "@bunyad/auth";
import { getRateLimiter } from "@bunyad/http";
import { LiveComponent } from "@bunyad/live";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import type User from "@/Models/User.ts";
import { intendedUrl } from "@/Support/auth.ts";

const MAX_ATTEMPTS = 5;

export default class Login extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Log in";

  email = "";
  password = "";
  remember = false;

  /** Five failures lock the email + IP for a minute. */
  async login(): Promise<void> {
    await this.validate({ email: "required|string|email", password: "required|string" });

    const limiter = getRateLimiter();
    const key = loginThrottleKey(request(), this.email);
    if (await limiter.tooManyAttempts(key, MAX_ATTEMPTS)) {
      const seconds = await limiter.availableIn(key);
      throw ValidationException.withMessages({
        email: `Too many login attempts. Please try again in ${seconds} seconds.`,
      });
    }

    const valid = await Auth.validate({ email: this.email, password: this.password });
    this.password = "";
    if (!valid) {
      await limiter.hit(key);
      throw ValidationException.withMessages({
        email: "These credentials do not match our records.",
      });
    }
    await limiter.clear(key);

    const user = Auth.getLastAttempted(request()) as User;
    // Hold the user in the session until they enter their authenticator code.
    if (user.hasEnabledTwoFactorAuthentication()) {
      request().session!.put("login.id", user.id);
      request().session!.put("login.remember", this.remember);
      this.navigate(route("two-factor.login"));
      return;
    }

    await Auth.login(request(), user, this.remember);
    this.navigate(intendedUrl(route("dashboard")));
  }

  view(): string {
    return "live.auth.login";
  }
}
