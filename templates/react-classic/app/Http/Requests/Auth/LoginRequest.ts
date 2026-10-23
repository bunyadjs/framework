import { FormRequest, getRateLimiter } from "@bunyad/http";
import { Auth, loginThrottleKey } from "@bunyad/auth";
import { ValidationException } from "@bunyad/validation";
import type User from "@/Models/User.ts";

type Credentials = { email: string; password: string; remember?: boolean };

const MAX_ATTEMPTS = 5;

export default class LoginRequest extends FormRequest<Credentials> {
  authorize() {
    return true;
  }

  rules() {
    return {
      email: "required|string|email",
      password: "required|string",
    };
  }

  /**
   * The user for these credentials, or fail on `email`. Five failures lock
   * the email + IP for a minute. Does not log in: two-factor users still
   * have a code to enter.
   */
  async validateCredentials(): Promise<User> {
    await this.ensureIsNotRateLimited();

    const { email, password } = this.validated();
    if (!(await Auth.validate({ email, password }))) {
      await getRateLimiter().hit(this.throttleKey());
      throw ValidationException.withMessages({
        email: "These credentials do not match our records.",
      });
    }

    await getRateLimiter().clear(this.throttleKey());
    return Auth.getLastAttempted(this) as User;
  }

  async ensureIsNotRateLimited(): Promise<void> {
    const limiter = getRateLimiter();
    if (!(await limiter.tooManyAttempts(this.throttleKey(), MAX_ATTEMPTS))) return;

    const seconds = await limiter.availableIn(this.throttleKey());
    throw ValidationException.withMessages({
      email: `Too many login attempts. Please try again in ${seconds} seconds.`,
    });
  }

  throttleKey(): string {
    return loginThrottleKey(this);
  }
}
