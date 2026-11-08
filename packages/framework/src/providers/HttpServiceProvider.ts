import { ServiceProvider } from "@bunyad/core";
import {
  RateLimiter,
  handleCors,
  registerRateLimitPresets,
  setCorsConfig,
  setRateLimiter,
  setTrustedProxies,
  getRateLimiter,
  type CorsConfig,
  type Middleware,
  type RateLimiterCache,
} from "@bunyad/http";

function hasAlias(layer: Middleware, alias: string): boolean {
  return (
    typeof layer === "object" &&
    layer !== null &&
    "alias" in layer &&
    (layer as { alias?: string }).alias === alias
  );
}

/** `config/http.ts` options read by the HTTP provider. */
export type HttpConfig = {
  /**
   * Proxies allowed to supply the client address through `X-Forwarded-For`: exact addresses,
   * `10.0.0.` prefixes, CIDR ranges (IPv4 or IPv6), or `"*"`. Default: none.
   * `"*"` trusts every hop, so a client can then choose its own address; use it only behind a
   * proxy that replaces the header.
   * The `TRUSTED_PROXIES` environment variable (comma separated, or `*`) is used when this is unset.
   */
  trusted_proxies?: string[] | "*";
  /** Believe `X-Real-IP` when there is no `X-Forwarded-For`, for a proxy known to set it. Default: false. */
  trust_real_ip?: boolean;
};

/** `"10.0.0.0/8, ::1"` or `"*"` from an environment variable. */
function proxiesFromEnv(value: string | undefined): string[] | "*" | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text === "*") return "*";
  const list = text.split(",").map((entry) => entry.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export class HttpServiceProvider extends ServiceProvider {
  register(): void {
    const rateLimiter = new RateLimiter();
    registerRateLimitPresets(rateLimiter);
    setRateLimiter(rateLimiter);

    const cors = this.app.config.get<CorsConfig>("cors");
    setCorsConfig(cors);

    const http = this.app.config.get<HttpConfig>("http");
    const proxies = http?.trusted_proxies ?? proxiesFromEnv(process.env.TRUSTED_PROXIES);
    if (proxies !== undefined) setTrustedProxies(proxies, { realIp: http?.trust_real_ip === true });
  }

  boot(): void {
    // Share rate-limit counters across workers when Cache is bound.
    try {
      getRateLimiter().use(this.app.make<RateLimiterCache>("cache"));
    } catch {
      // Cache provider not registered — keep process-local Map.
    }

    const stack = this.app.getMiddleware();
    const layers: Middleware[] = [];
    if (!stack.some((layer) => hasAlias(layer, "cors"))) layers.push(handleCors());
    if (layers.length > 0) this.app.middleware([...layers, ...stack]);
  }
}
