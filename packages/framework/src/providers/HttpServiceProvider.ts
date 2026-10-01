import { ServiceProvider } from "@bunyad/core";
import {
  RateLimiter,
  handleCors,
  registerRateLimitPresets,
  setCorsConfig,
  setRateLimiter,
  getRateLimiter,
  type CorsConfig,
  type Middleware,
  type RateLimiterCache,
} from "@bunyad/http";

function isCorsMiddleware(layer: Middleware): boolean {
  return (
    typeof layer === "object" &&
    layer !== null &&
    "alias" in layer &&
    (layer as { alias?: string }).alias === "cors"
  );
}

export class HttpServiceProvider extends ServiceProvider {
  register(): void {
    const rateLimiter = new RateLimiter();
    registerRateLimitPresets(rateLimiter);
    setRateLimiter(rateLimiter);

    const cors = this.app.config.get<CorsConfig>("cors");
    setCorsConfig(cors);
  }

  boot(): void {
    // Share rate-limit counters across workers when Cache is bound.
    try {
      getRateLimiter().use(this.app.make<RateLimiterCache>("cache"));
    } catch {
      // Cache provider not registered — keep process-local Map.
    }

    const stack = this.app.getMiddleware();
    if (stack.some(isCorsMiddleware)) return;
    this.app.middleware([handleCors(), ...stack]);
  }
}
