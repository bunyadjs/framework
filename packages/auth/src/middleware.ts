import type { Request, Next } from "@bunyad/http";
import {
  aliasMiddleware,
  json,
  redirect,
  taggedMiddleware,
  Limit,
  getRateLimiter,
} from "@bunyad/http";
import type { SessionGuard } from "./guard.ts";
import { Auth, getDefaultGuardName } from "./guard.ts";
import { TokenGuard } from "./token-guard.ts";
import { authorize } from "./gate.ts";
import { Hash } from "./hash.ts";
import { dispatchAuthEvent, PasswordConfirmed } from "./events.ts";

export type AuthGuard =
  | Pick<SessionGuard, "check" | "user">
  | Pick<TokenGuard, "check" | "user">
  | {
      check(request: Request): Promise<boolean>;
      user(request: Request): Promise<unknown>;
    };

let guestsRedirectTo: string | ((request: Request) => string) = "/login";
let usersRedirectTo: string | ((request: Request) => string) = "/dashboard";
let passwordConfirmTimeoutSeconds = 10800;

/** App-level default for where guests are sent (`auth` middleware). */
export function redirectGuestsTo(
  path: string | ((request: Request) => string),
): void {
  guestsRedirectTo = path;
}

/** App-level default for where authenticated users are sent (`guest` middleware). */
export function redirectUsersTo(
  path: string | ((request: Request) => string),
): void {
  usersRedirectTo = path;
}

/** Default seconds for `password.confirm` (`config/auth.ts` `password_timeout`). */
export function setPasswordConfirmTimeout(seconds: number): void {
  passwordConfirmTimeoutSeconds = seconds;
}

export function getPasswordConfirmTimeout(): number {
  return passwordConfirmTimeoutSeconds;
}

export function getGuestsRedirectPath(request: Request): string {
  return typeof guestsRedirectTo === "function"
    ? guestsRedirectTo(request)
    : guestsRedirectTo;
}

export function getUsersRedirectPath(request: Request): string {
  return typeof usersRedirectTo === "function"
    ? usersRedirectTo(request)
    : usersRedirectTo;
}

export type AuthenticateOptions = {
  /** Guard instance, factory, or name (`web` / `token` / custom). */
  guard?: AuthGuard | (() => AuthGuard) | string;
  /** Where to send guests (auth middleware). */
  loginPath?: string;
  /** Where to send authenticated users (guest middleware). */
  homePath?: string;
};

function resolveGuard(guard: AuthenticateOptions["guard"]): AuthGuard {
  if (guard === undefined) guard = getDefaultGuardName();
  if (guard === "web") return Auth();
  if (typeof guard === "string") return Auth.guard(guard) as AuthGuard;
  if (typeof guard === "function") return guard();
  return guard;
}

/** `auth` / `auth:token` middleware. */
export function auth(options: AuthenticateOptions = {}) {
  const alias =
    typeof options.guard === "string" ? `auth:${options.guard}` : "auth";

  return taggedMiddleware(alias, {
    async handle(request: Request, next: Next) {
      const guard = resolveGuard(options.guard);
      if (await guard.check(request)) return next();
      // Token guards are stateless: there is no login page to send guests to.
      if (guard instanceof TokenGuard) {
        return json({ message: "Unauthenticated." }, 401);
      }
      const loginPath =
        options.loginPath ?? getGuestsRedirectPath(request);
      return unauthenticated(request, loginPath);
    },
  });
}

/**
 * HTML / Inertia guests redirect to login; JSON clients get 401.
 * Stores `url.intended` for `redirect().intended()`.
 */
function unauthenticated(request: Request, loginPath: string) {
  const session = request.session;
  if (session && typeof session.put === "function") {
    try {
      session.put("url.intended", request.fullUrl());
    } catch {
      // Session may be read-only in some tests.
    }
  }

  if (request.header("x-inertia") === "true") {
    return redirect(loginPath);
  }
  const accept = (request.header("accept") ?? "").toLowerCase();
  if (!accept || accept === "*/*" || accept.includes("text/html")) {
    return redirect(loginPath);
  }
  const html = accept.indexOf("text/html");
  const jsonIdx = accept.indexOf("application/json");
  if (jsonIdx === -1 || (html !== -1 && html < jsonIdx)) {
    return redirect(loginPath);
  }
  return json({ message: "Unauthenticated." }, 401);
}

function tokenAbilities(mode: "all" | "any", abilities: string[]) {
  return taggedMiddleware(`${mode === "all" ? "abilities" : "ability"}:${abilities.join(",")}`, {
    async handle(request: Request, next: Next) {
      const guard = Auth.guard("token") as TokenGuard;
      const user = await guard.user(request);
      if (!user) return json({ message: "Unauthenticated." }, 401);
      const allowed =
        mode === "all"
          ? abilities.every((a) => guard.tokenCan(request, a))
          : abilities.some((a) => guard.tokenCan(request, a));
      if (!allowed) return json({ message: "Invalid ability provided." }, 403);
      return next();
    },
  });
}

/** `abilities:a,b` — the token must carry every listed ability. */
export function abilities(...list: string[]) {
  return tokenAbilities("all", list);
}

/** `ability:a,b` — the token must carry at least one listed ability. */
export function ability(...list: string[]) {
  return tokenAbilities("any", list);
}

/** `guest` middleware. */
export function guest(options: AuthenticateOptions = {}) {
  return taggedMiddleware("guest", {
    async handle(request: Request, next: Next) {
      const guard = resolveGuard(options.guard);
      if (!(await guard.check(request))) return next();
      const homePath = options.homePath ?? getUsersRedirectPath(request);
      return redirect(homePath);
    },
  });
}

export type CanMiddlewareOptions = {
  /** Resolve model / extra args for the ability (e.g. load Post from route). */
  resolve?: (request: Request) => unknown | Promise<unknown>;
};

/**
 * `can:update,post` middleware.
 * Pass a route param name (`can("delete", "post")`) or options with resolve.
 */
export function can(
  ability: string,
  optionsOrParam: CanMiddlewareOptions | string = {},
) {
  const options: CanMiddlewareOptions =
    typeof optionsOrParam === "string"
      ? { resolve: (request) => request.model(optionsOrParam) }
      : optionsOrParam;
  const alias =
    typeof optionsOrParam === "string"
      ? `can:${ability},${optionsOrParam}`
      : `can:${ability}`;

  return taggedMiddleware(alias, {
    async handle(request: Request, next: Next) {
      if (options.resolve) {
        const model = await options.resolve(request);
        await authorize(request, ability, model);
      } else {
        await authorize(request, ability);
      }
      return next();
    },
  });
}

export type ConfirmPasswordOptions = {
  /** Redirect when confirmation is missing/expired. */
  redirectTo?: string;
  /** Seconds until confirmation expires (default 3 hours). */
  timeout?: number;
};

/**
 * Require a recent password confirmation (`password.confirm` middleware).
 */
export function confirmPassword(options: ConfirmPasswordOptions = {}) {
  const redirectTo = options.redirectTo ?? "/confirm-password";
  const timeout = options.timeout ?? passwordConfirmTimeoutSeconds;
  return taggedMiddleware("password.confirm", {
    async handle(request: Request, next: Next) {
      const session = request.session;
      if (session?.passwordConfirmed?.(timeout)) return next();
      if (request.expectsJson()) {
        return json({ message: "Password confirmation required." }, 423);
      }
      // Come back here once the password is confirmed.
      session?.put("url.intended", request.fullUrl());
      return redirect(redirectTo);
    },
  });
}

/** Mark the session as password-confirmed (after a successful confirm form). */
export async function markPasswordConfirmed(request: Request): Promise<void> {
  request.session?.put("auth.password_confirmed_at", Date.now() / 1000);
  const user = request.user as
    | { id: string | number; password?: unknown }
    | undefined;
  if (user) {
    await dispatchAuthEvent(new PasswordConfirmed(user as never, request));
  }
}

/**
 * Verify the given password against the authenticated user and mark confirmed.
 */
export async function confirmPasswordFor(
  request: Request,
  password: string,
): Promise<boolean> {
  const user = (await Auth().user(request)) as
    | { password?: unknown }
    | null;
  if (!user?.password) return false;
  if (!(await Hash.check(password, String(user.password)))) return false;
  await markPasswordConfirmed(request);
  return true;
}

/**
 * Rate-limit key for login attempts: `email|ip` (lowercase email).
 */
export function loginThrottleKey(
  request: Request,
  email?: string,
): string {
  const value = (
    email ??
    String(request.input?.("email") ?? request.input?.("username") ?? "")
  )
    .toLowerCase()
    .trim();
  return `${value}|${request.ip()}`;
}

/**
 * Named RateLimiter for login: 5 attempts / minute by email+IP.
 * Register once: `RateLimiter.for("login", loginLimiter)`.
 */
export function loginLimiter(request: Request): Limit {
  return Limit.perMinute(5).by(loginThrottleKey(request));
}

/** Ensure the `login` limiter is registered (idempotent). */
export function registerLoginLimiter(): void {
  const limiter = getRateLimiter();
  if (!limiter.limiter("login")) {
    limiter.for("login", (ctx) => loginLimiter(ctx as Request));
  }
}

aliasMiddleware("auth", (...params: string[]) => {
  if (params[0]) return auth({ guard: params[0] });
  return auth();
});

aliasMiddleware("guest", () => guest());
aliasMiddleware("abilities", (...list: string[]) => abilities(...list));
aliasMiddleware("ability", (...list: string[]) => ability(...list));

aliasMiddleware("can", (ability: string, modelParam?: string) => {
  if (!ability) return can("view");
  if (modelParam) return can(ability, modelParam);
  return can(ability);
});

aliasMiddleware("password.confirm", (...params: string[]) => {
  const timeout = params[0] ? Number(params[0]) : undefined;
  return confirmPassword({
    timeout: Number.isFinite(timeout) ? timeout : undefined,
  });
});
