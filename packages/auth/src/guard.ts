import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "@bunyad/http";
import {
  abort,
  forgetQueuedCookie,
  pullQueuedCookie,
  queueCookie,
} from "@bunyad/http";
import { getUrlContext } from "@bunyad/router";
import { Hash } from "./hash.ts";
import type { TokenGuard } from "./token-guard.ts";
import { dispatchAuthEvent, Failed, Login, Logout } from "./events.ts";
import { rememberCookieSecure } from "./remember-cookie-secure.ts";

export type Authenticatable = {
  id: string | number;
  password?: unknown;
  name?: unknown;
  email?: unknown;
  remember_token?: unknown;
};

export type Credentials = {
  email?: string;
  username?: string;
  password?: string;
  [key: string]: unknown;
};


/** SHA-256 hex digest of a remember-me secret (stored; cookie keeps plaintext). */
function hashRememberToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare of stored digest vs cookie plaintext (hashes cookie first). */
function rememberTokenMatches(stored: string, plain: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(hashRememberToken(plain), "utf8");
  if (a.length !== b.length) {
    // Legacy plaintext fallback (pre-hash rows): compare equal-length padded buffers safely.
    if (a.length === Buffer.byteLength(plain, "utf8")) {
      try {
        return timingSafeEqual(a, Buffer.from(plain, "utf8"));
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * User lookup / persistence contract for session guards.
 * Prefer this when registering custom providers; SessionGuard still accepts
 * flat retrieve callbacks for simple apps.
 */
export type UserProvider = {
  retrieveById(
    id: string | number,
  ): Authenticatable | null | Promise<Authenticatable | null>;
  retrieveByCredentials(
    credentials: Credentials,
  ): Authenticatable | null | Promise<Authenticatable | null>;
  updateRememberToken?(
    user: Authenticatable,
    token: string | null,
  ): void | Promise<void>;
  updatePassword?(
    user: Authenticatable,
    hashedPassword: string,
  ): void | Promise<void>;
};

export type SessionGuardOptions = {
  retrieveById: (
    id: string | number,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  retrieveByCredentials: (
    email: string,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  /**
   * Persist the remember-me token digest (framework stores SHA-256; cookie keeps plaintext).
   * Pass `null` to clear on logout.
   */
  updateRememberToken?: (
    user: Authenticatable,
    token: string | null,
  ) => void | Promise<void>;
  /**
   * Persist a new password hash (used by `logoutOtherDevices`).
   */
  updatePassword?: (
    user: Authenticatable,
    hashedPassword: string,
  ) => void | Promise<void>;
  sessionKey?: string;
  /** Remember cookie name (default `remember_web`). */
  rememberCookie?: string;
  /** Remember cookie lifetime in minutes (default 576000 ≈ 400 days). */
  rememberMinutes?: number;
};

/** Build a SessionGuard from a UserProvider. */
export function sessionGuardFromProvider(
  provider: UserProvider,
  options: Omit<
    SessionGuardOptions,
    "retrieveById" | "retrieveByCredentials" | "updateRememberToken" | "updatePassword"
  > = {},
): SessionGuard {
  return new SessionGuard({
    ...options,
    retrieveById: (id) => provider.retrieveById(id),
    retrieveByCredentials: async (email) =>
      provider.retrieveByCredentials({ email }),
    updateRememberToken: provider.updateRememberToken?.bind(provider),
    updatePassword: provider.updatePassword?.bind(provider),
  });
}

/** Per-request guard state. The guard itself is shared by every request. */
type GuardRequestState = {
  viaRemember: boolean;
  lastAttempted: Authenticatable | null;
};

function resolveCredentials(
  emailOrCredentials: string | Credentials,
  passwordOrRemember?: string | boolean,
  rememberFlag?: boolean,
): { email: string; password: string; remember: boolean } {
  if (typeof emailOrCredentials === "string") {
    return {
      email: emailOrCredentials,
      password: String(passwordOrRemember ?? ""),
      remember: Boolean(rememberFlag),
    };
  }
  return {
    email: String(emailOrCredentials.email ?? emailOrCredentials.username ?? ""),
    password: String(emailOrCredentials.password ?? ""),
    remember: Boolean(passwordOrRemember),
  };
}

/**
 * Session authentication guard.
 */
export class SessionGuard {
  readonly #retrieveById: SessionGuardOptions["retrieveById"];
  readonly #retrieveByCredentials: SessionGuardOptions["retrieveByCredentials"];
  readonly #updateRememberToken: SessionGuardOptions["updateRememberToken"];
  readonly #updatePassword: SessionGuardOptions["updatePassword"];
  readonly #sessionKey: string;
  readonly #rememberCookie: string;
  #rememberMinutes: number;
  /** Keyed by the raw request so Form Request copies share state. */
  readonly #states = new WeakMap<globalThis.Request, GuardRequestState>();
  /** State for calls made outside a request (console, unit tests). */
  readonly #detached: GuardRequestState = { viaRemember: false, lastAttempted: null };

  constructor(options: SessionGuardOptions) {
    this.#retrieveById = options.retrieveById;
    this.#retrieveByCredentials = options.retrieveByCredentials;
    this.#updateRememberToken = options.updateRememberToken;
    this.#updatePassword = options.updatePassword;
    this.#sessionKey = options.sessionKey ?? "login_web";
    this.#rememberCookie = options.rememberCookie ?? "remember_web";
    this.#rememberMinutes = options.rememberMinutes ?? 576_000;
  }

  #state(request?: Request): GuardRequestState {
    const current = request ?? getUrlContext().request;
    if (!current) return this.#detached;
    let state = this.#states.get(current.raw);
    if (!state) {
      state = { viaRemember: false, lastAttempted: null };
      this.#states.set(current.raw, state);
    }
    return state;
  }

  /** Look up the user for `credentials` and check the password. */
  async #attemptUser(
    credentials: Credentials,
    request?: Request,
  ): Promise<Authenticatable | null> {
    const email = String(credentials.email ?? credentials.username ?? "");
    const password = String(credentials.password ?? "");
    const user = await this.#retrieveByCredentials(email);
    this.#state(request).lastAttempted = user;
    if (!user?.password) return null;
    return (await Hash.check(password, String(user.password))) ? user : null;
  }

  /**
   * Attempt login.
   * - `attempt(request, email, password, remember?)`
   * - `attempt(request, { email, password }, remember?)`
   */
  async attempt(
    request: Request,
    emailOrCredentials: string | Credentials,
    passwordOrRemember?: string | boolean,
    rememberFlag?: boolean,
  ): Promise<boolean> {
    const { email, password, remember } = resolveCredentials(
      emailOrCredentials,
      passwordOrRemember,
      rememberFlag,
    );
    const user = await this.#attemptUser({ email, password }, request);
    if (!user) {
      await dispatchAuthEvent(
        new Failed({ email, password }, this.#state(request).lastAttempted, request, "web"),
      );
      return false;
    }
    await this.#rehashIfRequired(user, password);
    await this.login(request, user, remember);
    return true;
  }

  /**
   * Attempt login with an additional callback.
   */
  async attemptWhen(
    request: Request,
    credentials: Credentials,
    callback:
      | ((user: Authenticatable) => boolean | Promise<boolean>)
      | Array<(user: Authenticatable) => boolean | Promise<boolean>>,
    remember = false,
  ): Promise<boolean> {
    const user = await this.#attemptUser(credentials, request);
    if (!user) return false;
    const callbacks = Array.isArray(callback) ? callback : [callback];
    for (const cb of callbacks) {
      if (!(await cb(user))) return false;
    }
    await this.#rehashIfRequired(user, String(credentials.password ?? ""));
    await this.login(request, user, remember);
    return true;
  }

  /**
   * Validate credentials without logging in.
   */
  async validate(credentials: Credentials): Promise<boolean> {
    return (await this.#attemptUser(credentials)) !== null;
  }

  /**
   * Ensure the user is authenticated or throw 401.
   */
  async authenticate(request: Request): Promise<Authenticatable> {
    const user = await this.user(request);
    if (!user) abort(401, "Unauthenticated.");
    return user;
  }

  /**
   * Validate credentials against a user.
   */
  async hasValidCredentials(
    user: Authenticatable | null,
    credentials: Credentials,
  ): Promise<boolean> {
    if (!user?.password) return false;
    const password = String(credentials.password ?? "");
    return Hash.check(password, String(user.password));
  }

  /**
   * HTTP Basic Auth — session login.
   * Returns a 401 response on failure, or `null` on success.
   */
  async basic(
    request: Request,
    field = "email",
  ): Promise<globalThis.Response | null> {
    if (await this.check(request)) return null;
    if (await this.attemptBasic(request, field)) return null;
    return this.failedBasicResponse();
  }

  /**
   * Stateless HTTP Basic Auth.
   */
  async onceBasic(
    request: Request,
    field = "email",
  ): Promise<globalThis.Response | null> {
    if (await this.check(request)) return null;
    const credentials = this.basicCredentials(request, field);
    if (await this.once(request, credentials)) return null;
    return this.failedBasicResponse();
  }

  /**
   * Attempt Basic Auth credentials.
   */
  async attemptBasic(request: Request, field = "email"): Promise<boolean> {
    return this.attempt(request, this.basicCredentials(request, field));
  }

  /** Credentials from an Authorization: Basic header. */
  basicCredentials(request: Request, field = "email"): Credentials {
    const header = request.header("authorization");
    if (!header?.toLowerCase().startsWith("basic ")) {
      return { [field]: "", password: "" };
    }
    try {
      const decoded = atob(header.slice(6).trim());
      const i = decoded.indexOf(":");
      const username = i === -1 ? decoded : decoded.slice(0, i);
      const password = i === -1 ? "" : decoded.slice(i + 1);
      return { [field]: username, password };
    } catch {
      return { [field]: "", password: "" };
    }
  }

  failedBasicResponse(): globalThis.Response {
    return new globalThis.Response("Invalid credentials.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Login"' },
    });
  }

  /** Session key name. */
  getName(): string {
    return this.#sessionKey;
  }

  /** Remember cookie name. */
  getRecallerName(): string {
    return this.#rememberCookie;
  }

  getRememberDuration(): number {
    return this.#rememberMinutes;
  }

  setRememberDuration(minutes: number): this {
    this.#rememberMinutes = minutes;
    return this;
  }

  /**
   * Log the user in for this request only — no session write.
   */
  async once(
    request: Request,
    emailOrCredentials: string | Credentials,
    password?: string,
  ): Promise<boolean> {
    const { email, password: pass } = resolveCredentials(
      emailOrCredentials,
      password,
    );
    const user = await this.#attemptUser({ email, password: pass }, request);
    if (!user) return false;
    this.setUser(request, user);
    return true;
  }

  /**
   * Log in by id for this request only.
   */
  async onceUsingId(
    request: Request,
    id: string | number,
  ): Promise<Authenticatable | false> {
    const user = await this.#retrieveById(id);
    if (!user) return false;
    this.setUser(request, user);
    return user;
  }

  /**
   * Log in by primary key.
   */
  async loginUsingId(
    request: Request,
    id: string | number,
    remember = false,
  ): Promise<Authenticatable | false> {
    const user = await this.#retrieveById(id);
    if (!user) return false;
    await this.login(request, user, remember);
    return user;
  }

  async login(
    request: Request,
    user: Authenticatable,
    remember = false,
  ): Promise<void> {
    this.#state(request).viaRemember = false;
    // Session fixation: rotate id before binding the login key (BUN-SEC-001).
    request.session?.regenerate?.(true);
    request.session!.put(this.#sessionKey, user.id);
    request.user = user;

    if (remember && this.#updateRememberToken) {
      const token = randomBytes(30).toString("hex");
      const hashed = hashRememberToken(token);
      await this.#updateRememberToken(user, hashed);
      user.remember_token = hashed;
      this.#queueRememberCookie(request, `${user.id}|${token}`);
    }
    await dispatchAuthEvent(new Login(user, remember, request, "web"));
  }

  /**
   * Set the user on the request without touching the session
   *.
   */
  setUser(request: Request, user: Authenticatable): this {
    this.#state(request).viaRemember = false;
    request.user = user;
    return this;
  }

  /** Whether a user was already resolved for the request. */
  hasUser(request?: Request): boolean {
    return Boolean((request ?? getUrlContext().request)?.user);
  }

  /** Last user for which credentials were validated. */
  getLastAttempted(request?: Request): Authenticatable | null {
    return this.#state(request).lastAttempted;
  }

  async user(request: Request): Promise<Authenticatable | null> {
    if (request.user) return request.user as Authenticatable;

    const id = request.session?.get<string | number>(this.#sessionKey);
    if (id !== undefined && id !== null) {
      const user = await this.#retrieveById(id);
      if (user) {
        request.user = user;
        return user;
      }
      // Stale login id (expired / deleted user) — clear like a guest session.
      request.session?.forget(this.#sessionKey);
    }

    return this.#userFromRemember(request);
  }

  /** Alias for `user`. */
  getUser(request: Request): Promise<Authenticatable | null> {
    return this.user(request);
  }

  async #userFromRemember(request: Request): Promise<Authenticatable | null> {
    const raw = request.cookie(this.#rememberCookie);
    if (!raw) return null;

    const sep = raw.indexOf("|");
    if (sep === -1) return null;
    const id = raw.slice(0, sep);
    const token = raw.slice(sep + 1);
    if (!id || !token) return null;

    const user = await this.#retrieveById(id);
    if (!user?.remember_token) return null;
    if (!rememberTokenMatches(String(user.remember_token), token)) return null;

    this.#state(request).viaRemember = true;
    request.session?.put(this.#sessionKey, user.id);
    request.user = user;
    return user;
  }

  /** Whether this request authenticated via the remember cookie. */
  viaRemember(request?: Request): boolean {
    return this.#state(request).viaRemember;
  }

  /**
   * Take the queued remember cookie off the response queue: its value,
   * `null` when it is being cleared, or `undefined` if unchanged. The kernel
   * attaches queued cookies itself; call this only to attach it by hand.
   */
  pullRememberCookie(request: Request): string | null | undefined {
    const cookie = pullQueuedCookie(request, this.#rememberCookie);
    if (!cookie) return undefined;
    return cookie.options.maxAge === 0 ? null : cookie.value;
  }

  #queueRememberCookie(request: Request, value: string): void {
    queueCookie(request, this.#rememberCookie, value, {
      maxAge: this.rememberCookieMaxAge(),
      secure: rememberCookieSecure(request),
    });
  }

  rememberCookieName(): string {
    return this.#rememberCookie;
  }

  rememberCookieMaxAge(): number {
    return this.#rememberMinutes * 60;
  }

  async check(request: Request): Promise<boolean> {
    return (await this.user(request)) !== null;
  }

  /** Whether the user is a guest. */
  async guest(request: Request): Promise<boolean> {
    return !(await this.check(request));
  }

  async id(request: Request): Promise<string | number | null> {
    return (await this.user(request))?.id ?? null;
  }

  async logout(request: Request): Promise<void> {
    const user = (request.user as Authenticatable | undefined) ?? null;
    if (user && this.#updateRememberToken) {
      await this.#updateRememberToken(user, null);
    }
    this.clearUserDataFromStorage(request);
    // Destroy session bag + rotate id so the old cookie cannot be reused (BUN-SEC-001).
    request.session?.invalidate?.();
    await dispatchAuthEvent(new Logout(user, request, "web"));
  }

  /**
   * Log out current device only — does not cycle the remember token
   *.
   */
  async logoutCurrentDevice(request: Request): Promise<void> {
    this.clearUserDataFromStorage(request);
  }

  /**
   * Remove user id / remember cookie from the request.
   */
  clearUserDataFromStorage(request: Request): void {
    request.session?.forget(this.#sessionKey);
    request.user = undefined;
    this.#state(request).viaRemember = false;
    forgetQueuedCookie(request, this.#rememberCookie);
  }

  /** Forget the cached user without writing storage. */
  forgetUser(request?: Request): this {
    const current = request ?? getUrlContext().request;
    if (current) {
      current.user = undefined;
      this.#state(current).viaRemember = false;
    }
    return this;
  }

  /**
   * Invalidate other sessions/devices by rotating the password hash and
   * remember token.
   */
  async logoutOtherDevices(
    request: Request,
    password: string,
  ): Promise<Authenticatable | false> {
    const user = await this.user(request);
    if (!user?.password) return false;
    if (!(await Hash.check(password, String(user.password)))) return false;

    const hashed = await Hash.make(password);
    user.password = hashed;
    if (this.#updatePassword) {
      await this.#updatePassword(user, hashed);
    }

    if (this.#updateRememberToken) {
      const token = randomBytes(30).toString("hex");
      const hashed = hashRememberToken(token);
      await this.#updateRememberToken(user, hashed);
      user.remember_token = hashed;
      this.#queueRememberCookie(request, `${user.id}|${token}`);
    }

    return user;
  }

  /** Rehash and persist when the stored hash is outdated. */
  async #rehashIfRequired(
    user: Authenticatable,
    password: string,
  ): Promise<void> {
    if (!user.password || !Hash.needsRehash(String(user.password))) return;
    const hashed = await Hash.make(password);
    user.password = hashed;
    if (this.#updatePassword) {
      await this.#updatePassword(user, hashed);
    }
  }
}

let defaultGuard: SessionGuard | undefined;
let defaultTokenGuard: TokenGuard | undefined;

/** Custom guard factories registered via `Auth.extend`. */
const extendedGuards = new Map<string, () => unknown>();
/** Request-based guards registered via `Auth.viaRequest`. */
const viaRequestCallbacks = new Map<
  string,
  (
    request: Request,
  ) => Authenticatable | null | Promise<Authenticatable | null>
>();

let defaultGuardName = "web";

/** Guard used by `auth` / `guest` middleware when none is named (`config/auth.ts` `defaults.guard`). */
export function setDefaultGuardName(name: string): void {
  defaultGuardName = name;
}

export function getDefaultGuardName(): string {
  return defaultGuardName;
}

export function setAuthGuard(guard: SessionGuard): void {
  defaultGuard = guard;
}

export function getAuthGuard(): SessionGuard | undefined {
  return defaultGuard;
}

export function setDefaultTokenGuard(guard: TokenGuard): void {
  defaultTokenGuard = guard;
}

export function getTokenGuard(): TokenGuard | undefined {
  return defaultTokenGuard;
}

function sessionGuard(): SessionGuard {
  return defaultGuard!;
}

type AnyGuard = SessionGuard | TokenGuard | {
  check(request: Request): Promise<boolean>;
  user(request: Request): Promise<Authenticatable | null>;
};

function authGuard(name?: string): AnyGuard {
  if (!name || name === "web") return defaultGuard!;
  if (name === "token") return defaultTokenGuard!;
  const via = viaRequestCallbacks.get(name);
  if (via) {
    return {
      async check(request: Request) {
        return (await via(request)) !== null;
      },
      async user(request: Request) {
        const user = await via(request);
        if (user) request.user = user;
        return user;
      },
    };
  }
  const factory = extendedGuards.get(name);
  if (factory) return factory() as AnyGuard;
  throw new Error(
    `Auth guard [${name}] is not defined. Register it with Auth.extend or Auth.viaRequest.`,
  );
}

type AuthFacade = {
  (): SessionGuard;
  guard(name: "token"): TokenGuard;
  guard(name?: "web"): SessionGuard;
  guard(name: string): AnyGuard;
  extend(name: string, factory: () => unknown): typeof Auth;
  viaRequest(
    name: string,
    callback: (
      request: Request,
    ) => Authenticatable | null | Promise<Authenticatable | null>,
  ): typeof Auth;
  attempt: SessionGuard["attempt"];
  attemptWhen: SessionGuard["attemptWhen"];
  validate: SessionGuard["validate"];
  authenticate: SessionGuard["authenticate"];
  once: SessionGuard["once"];
  onceUsingId: SessionGuard["onceUsingId"];
  onceBasic: SessionGuard["onceBasic"];
  basic: SessionGuard["basic"];
  login: SessionGuard["login"];
  loginUsingId: SessionGuard["loginUsingId"];
  logout: SessionGuard["logout"];
  logoutCurrentDevice: SessionGuard["logoutCurrentDevice"];
  logoutOtherDevices: SessionGuard["logoutOtherDevices"];
  check: SessionGuard["check"];
  guest: SessionGuard["guest"];
  user: SessionGuard["user"];
  id: SessionGuard["id"];
  viaRemember: SessionGuard["viaRemember"];
  setUser: SessionGuard["setUser"];
  hasUser: SessionGuard["hasUser"];
  forgetUser: SessionGuard["forgetUser"];
  getUser: SessionGuard["getUser"];
  getLastAttempted: SessionGuard["getLastAttempted"];
  getName: SessionGuard["getName"];
  getRecallerName: SessionGuard["getRecallerName"];
};

function forward<K extends keyof SessionGuard>(method: K) {
  return ((...args: unknown[]) => {
    const guard = sessionGuard();
    const fn = guard[method];
    if (typeof fn === "function") {
      return (fn as (...a: unknown[]) => unknown).apply(guard, args);
    }
    return fn;
  }) as SessionGuard[K];
}

/** `Auth` facade. */
export const Auth = Object.assign(sessionGuard, {
  guard: authGuard,
  /** Register a named guard driver (`Auth.extend('jwt', () => new JwtGuard(...))`). */
  extend(name: string, factory: () => unknown) {
    extendedGuards.set(name, factory);
    return Auth;
  },
  /** Register a request-callback guard (`Auth.viaRequest('custom', (req) => user)`). */
  viaRequest(
    name: string,
    callback: (
      request: Request,
    ) => Authenticatable | null | Promise<Authenticatable | null>,
  ) {
    viaRequestCallbacks.set(name, callback);
    return Auth;
  },
  attempt: forward("attempt"),
  attemptWhen: forward("attemptWhen"),
  validate: forward("validate"),
  authenticate: forward("authenticate"),
  once: forward("once"),
  onceUsingId: forward("onceUsingId"),
  onceBasic: forward("onceBasic"),
  basic: forward("basic"),
  login: forward("login"),
  loginUsingId: forward("loginUsingId"),
  logout: forward("logout"),
  logoutCurrentDevice: forward("logoutCurrentDevice"),
  logoutOtherDevices: forward("logoutOtherDevices"),
  check: forward("check"),
  guest: forward("guest"),
  user: forward("user"),
  id: forward("id"),
  viaRemember: forward("viaRemember"),
  setUser: forward("setUser"),
  hasUser: forward("hasUser"),
  forgetUser: forward("forgetUser"),
  getUser: forward("getUser"),
  getLastAttempted: forward("getLastAttempted"),
  getName: forward("getName"),
  getRecallerName: forward("getRecallerName"),
}) as AuthFacade;

/** Clear custom guards (tests). */
export function flushAuthExtensions(): void {
  extendedGuards.clear();
  viaRequestCallbacks.clear();
}
