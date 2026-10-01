import type { Request } from "@bunyad/http";

/** Secure flag for the remember cookie: HTTPS requests, or production. */
export function rememberCookieSecure(request?: Request): boolean {
  if (request?.secure()) return true;
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}
