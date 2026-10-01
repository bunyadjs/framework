import { ServiceProvider } from "@bunyad/core";
import { loginThrottleKey } from "@bunyad/auth";
import { Limit, getRateLimiter } from "@bunyad/http";

export default class AppServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    // Five failed attempts per email and IP per minute. Successful requests are not counted.
    getRateLimiter().for("token", (request) =>
      Limit.perMinute(5)
        .by(loginThrottleKey(request))
        .after((response) => response.status >= 400),
    );
  }
}
