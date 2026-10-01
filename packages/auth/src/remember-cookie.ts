import type { Request } from "@bunyad/http";
import { serializeCookie } from "@bunyad/http";
import { getUrlContext } from "@bunyad/router";
import type { SessionGuard } from "./guard.ts";
import { Auth } from "./guard.ts";
import { rememberCookieSecure } from "./remember-cookie-secure.ts";

export type RememberCookieOptions = {
  /**
   * Set the Secure flag. Default: true when request is HTTPS or APP_ENV/NODE_ENV
   * is production.
   */
  secure?: boolean;
  domain?: string;
  sameSite?: "Lax" | "Strict" | "None";
  /** Request whose queued remember cookie to attach (default: current request). */
  request?: Request;
};

/**
 * Move the queued remember-me cookie onto a Response by hand. The kernel
 * already attaches queued cookies to route responses; use this for responses
 * built outside the kernel.
 */
export function appendRememberCookie(
  response: Response,
  guard: SessionGuard = Auth(),
  options: RememberCookieOptions = {},
): Response {
  const request = options.request ?? getUrlContext().request!;
  const value = guard.pullRememberCookie(request);
  if (value === undefined) return response;

  response.headers.append(
    "Set-Cookie",
    serializeCookie(guard.rememberCookieName(), value ?? "", {
      path: "/",
      maxAge: value === null ? 0 : guard.rememberCookieMaxAge(),
      httpOnly: true,
      sameSite: options.sameSite ?? "Lax",
      secure: options.secure ?? rememberCookieSecure(request),
      domain: options.domain,
    }),
  );
  return response;
}
