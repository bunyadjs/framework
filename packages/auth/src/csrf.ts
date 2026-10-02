import { timingSafeEqual } from "node:crypto";
import { Crypt } from "@bunyad/common";
import type { Request, Next } from "@bunyad/http";
import { json } from "@bunyad/http";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Constant-time comparison for CSRF session token vs request token. */
function tokensMatch(sessionToken: string, requestToken: unknown): boolean {
  if (typeof requestToken !== "string" || requestToken.length === 0) return false;
  const a = Buffer.from(sessionToken, "utf8");
  const b = Buffer.from(requestToken, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function decodeXsrfHeader(value: string): string {
  try {
    return Crypt.decrypt(value);
  } catch {
    return value;
  }
}

function isTestingEnv(): boolean {
  return process.env.APP_ENV === "testing";
}

function isProductionEnv(): boolean {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}

function normalizeExceptPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/** Exact or `*` wildcard match against a request pathname. */
function matchesExceptPattern(path: string, pattern: string): boolean {
  const p = normalizeExceptPath(path);
  const pat = normalizeExceptPath(pattern);
  if (!pat.includes("*")) return p === pat;
  const escaped = pat
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(p);
}

function isExceptedPath(path: string, patterns: Iterable<string>): boolean {
  for (const pattern of patterns) {
    if (matchesExceptPattern(path, pattern)) return true;
  }
  return false;
}

export type PreventRequestForgeryOptions = {
  /**
   * Pathnames skipped for verification (token is still issued).
   * Exact match, or `*` wildcards (`/stripe/*`, `webhooks/*`).
   */
  except?: string[];
  /** Pathname prefixes skipped (e.g. `/api`). */
  exceptPrefixes?: string[];
  /**
   * Allow `Sec-Fetch-Site: same-site` (trusted subdomains).
   */
  allowSameSite?: boolean;
  /**
   * Rely only on origin (`Sec-Fetch-Site`); no CSRF token fallback.
   * Failures return 403.
   */
  originOnly?: boolean;
  /**
   * When true, verify CSRF even under `APP_ENV=testing` / Bun test.
   * Default: skip verification in testing (token cookie/header still issued).
   */
  enableDuringTesting?: boolean;
};

/** @deprecated Use {@link PreventRequestForgeryOptions}. */
export type VerifyCsrfOptions = PreventRequestForgeryOptions;

/**
 * Request forgery prevention — Sec-Fetch-Site origin check, then CSRF token.
 *
 * 1. `Sec-Fetch-Site: same-origin` → allow (optional `same-site` when `allowSameSite`)
 * 2. Else if not `originOnly` → verify `_token` / `X-CSRF-TOKEN` / `X-XSRF-TOKEN`
 * 3. `originOnly` + failed origin → 403
 *
 * Sets `X-CSRF-TOKEN` header and encrypted `XSRF-TOKEN` cookie on the response.
 */
export function preventRequestForgery(
  options: PreventRequestForgeryOptions = {},
) {
  const except = options.except ?? [];
  const prefixes = options.exceptPrefixes ?? [];
  const allowSameSite = options.allowSameSite === true;
  const originOnly = options.originOnly === true;
  const skipInTesting = options.enableDuringTesting !== true;

  return {
    async handle(request: Request, next: Next) {
      if (!request.session) return next();

      if (!request.session.has("_token")) {
        request.session.put("_token", crypto.randomUUID());
      }

      const path = pathname(request.url);
      const skipped =
        Boolean(request.bearerToken()) ||
        isExceptedPath(path, except) ||
        prefixes.some(
          (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        ) ||
        (skipInTesting && isTestingEnv());

      if (!SAFE.has(request.method) && !skipped) {
        const originOk = hasValidOrigin(request, allowSameSite);

        if (originOk) {
          // Same-origin (or allowed same-site) — skip token check.
        } else if (originOnly) {
          return json({ message: "Origin mismatch." }, 403);
        } else {
          await request.loadJson();
          const rawToken =
            request.input("_token") ??
            request.header("x-csrf-token") ??
            request.header("x-xsrf-token");
          const token =
            typeof rawToken === "string" && request.header("x-xsrf-token") === rawToken
              ? decodeXsrfHeader(rawToken)
              : rawToken;

          if (!tokensMatch(String(request.session.get("_token") ?? ""), token)) {
            return json({ message: "CSRF token mismatch." }, 419);
          }
        }
      }

      const response = await next();
      const token = request.session.get<string>("_token");
      response.headers.set("X-CSRF-TOKEN", token);
      appendXsrfCookie(response, token, request);
      return response;
    },
  };
}

function appendXsrfCookie(
  response: Response,
  token: string,
  request: Request,
): void {
  let value = token;
  try {
    value = Crypt.encrypt(token);
  } catch {
    // APP_KEY missing in some unit tests — fall back to plaintext.
  }
  const secure =
    (typeof request.secure === "function" && request.secure()) ||
    isProductionEnv();
  let cookie = `XSRF-TOKEN=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (secure) cookie += "; Secure";
  response.headers.append("Set-Cookie", cookie);
}

/**
 * @deprecated Use {@link preventRequestForgery}. Alias kept for backward compatibility.
 */
export function verifyCsrf(options: VerifyCsrfOptions = {}) {
  return preventRequestForgery(options);
}

/** Current CSRF token helper. */
export function csrf_token(request: Request): string {
  if (!request.session!.has("_token")) {
    request.session!.put("_token", crypto.randomUUID());
  }
  return request.session!.get<string>("_token");
}

/**
 * Modern browsers send `Sec-Fetch-Site` on secure navigations.
 * `same-origin` always passes; `same-site` only when `allowSameSite`.
 * Missing header → not valid (fall back to token unless originOnly).
 */
export function hasValidOrigin(
  request: Request,
  allowSameSite = false,
): boolean {
  const sec =
    request.header("sec-fetch-site") ?? request.header("Sec-Fetch-Site");
  if (sec === "same-origin") return true;
  if (sec === "same-site" && allowSameSite) return true;
  return false;
}

function pathname(url: string): string {
  const start = url.indexOf("/", url.indexOf("://") + 3);
  if (start === -1) return "/";
  const end = url.indexOf("?", start);
  return end === -1 ? url.slice(start) : url.slice(start, end);
}
