import { createHash, randomBytes } from "node:crypto";
import type { Request } from "@bunyad/http";
import { abort } from "@bunyad/http";
import type { Authenticatable } from "./guard.ts";
import { getTokenGuard, setDefaultTokenGuard } from "./guard.ts";
import { Hash } from "./hash.ts";

export type AccessTokenRecord = {
  id: number;
  tokenable_id: string | number;
  name: string;
  token: string;
  /** Comma-separated abilities (`*` = all). */
  abilities?: string;
  /** Unix timestamp seconds; null/undefined = never expires. */
  expires_at?: number | null;
};

export type CreateTokenOptions = {
  abilities?: string[];
  /** Absolute expiry, or minutes from now when a number. */
  expiresAt?: Date | number | null;
};

export type TokenGuardOptions = {
  retrieveTokenById: (
    id: number,
  ) => AccessTokenRecord | null | Promise<AccessTokenRecord | null>;
  retrieveUserById: (
    id: string | number,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  /** Persist hashed token; returns new row id. */
  createTokenRecord: (data: {
    tokenable_id: string | number;
    name: string;
    token: string;
    abilities?: string;
    expires_at?: number | null;
  }) => number | Promise<number>;
  deleteTokenRecord: (id: number) => void | Promise<void>;
  /** Find a user by login credentials (everything except `password`). Enables `attempt`. */
  retrieveUserByCredentials?: (
    credentials: Record<string, unknown>,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  /** Cookie name for SPA first-party tokens (default `bunyad_token`). */
  cookieName?: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveExpiresAt(expiresAt?: Date | number | null): number | null {
  if (expiresAt === undefined || expiresAt === null) return null;
  if (expiresAt instanceof Date) {
    return Math.floor(expiresAt.getTime() / 1000);
  }
  return Math.floor(Date.now() / 1000) + Math.trunc(expiresAt) * 60;
}

function parseAbilities(raw: string | undefined): string[] {
  if (!raw || raw === "*") return ["*"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenAllows(record: AccessTokenRecord, ability: string): boolean {
  const abilities = parseAbilities(record.abilities);
  if (abilities.includes("*")) return true;
  return abilities.includes(ability);
}

function tokenExpired(record: AccessTokenRecord): boolean {
  if (record.expires_at == null) return false;
  return record.expires_at <= Math.floor(Date.now() / 1000);
}

/**
 * Personal access token guard.
 * Bearer format: `{id}|{secret}` — only the secret is stored hashed.
 */
export class TokenGuard {
  readonly #retrieveTokenById: TokenGuardOptions["retrieveTokenById"];
  readonly #retrieveUserById: TokenGuardOptions["retrieveUserById"];
  readonly #createTokenRecord: TokenGuardOptions["createTokenRecord"];
  readonly #deleteTokenRecord: TokenGuardOptions["deleteTokenRecord"];
  readonly #retrieveUserByCredentials: TokenGuardOptions["retrieveUserByCredentials"];
  readonly #cookieName: string;
  /** Per-request token, keyed by request and by the user resolved for it (never shared across requests). */
  readonly #accessTokens = new WeakMap<object, AccessTokenRecord>();

  constructor(options: TokenGuardOptions) {
    this.#retrieveTokenById = options.retrieveTokenById;
    this.#retrieveUserById = options.retrieveUserById;
    this.#createTokenRecord = options.createTokenRecord;
    this.#deleteTokenRecord = options.deleteTokenRecord;
    this.#retrieveUserByCredentials = options.retrieveUserByCredentials;
    this.#cookieName = options.cookieName ?? "bunyad_token";
  }

  /**
   * Issue a plain-text token (`id|secret`).
   * Optional abilities (default `*`) and expiry (Date or minutes).
   */
  async createToken(
    user: Authenticatable,
    name = "api",
    abilitiesOrOptions: string[] | CreateTokenOptions = ["*"],
  ): Promise<string> {
    const options: CreateTokenOptions = Array.isArray(abilitiesOrOptions)
      ? { abilities: abilitiesOrOptions }
      : abilitiesOrOptions;
    const abilities = (options.abilities ?? ["*"]).join(",");
    const secret = randomBytes(20).toString("hex");
    const id = await this.#createTokenRecord({
      tokenable_id: user.id,
      name,
      token: sha256(secret),
      abilities,
      expires_at: resolveExpiresAt(options.expiresAt),
    });
    return `${id}|${secret}`;
  }

  /**
   * Check `{ email, password }` against the user provider. Returns the user, or
   * `null` when the user is unknown or the password is wrong. It issues no token.
   */
  async attempt(
    credentials: { password: string } & Record<string, unknown>,
  ): Promise<Authenticatable | null> {
    if (!this.#retrieveUserByCredentials) {
      throw new Error(
        "TokenGuard.attempt() needs a retrieveUserByCredentials option.",
      );
    }
    const { password, ...lookup } = credentials;
    if (Object.keys(lookup).length === 0) return null;
    const user = await this.#retrieveUserByCredentials(lookup);
    const hashed = (user as { password?: unknown } | null)?.password;
    if (!user || typeof hashed !== "string" || hashed === "") return null;
    return (await Hash.check(String(password), hashed)) ? user : null;
  }

  /** Extract bearer token from the request. */
  getTokenForRequest(request: Request): string | null {
    const bearer = request.bearerToken();
    if (bearer) return bearer;
    const cookie = request.cookie(this.#cookieName);
    return cookie && cookie.length > 0 ? cookie : null;
  }

  async user(request: Request): Promise<Authenticatable | null> {
    if (request.user) return request.user as Authenticatable;

    const bearer = this.getTokenForRequest(request);
    if (!bearer) return null;

    const sep = bearer.indexOf("|");
    if (sep === -1) return null;
    const id = Number(bearer.slice(0, sep));
    const secret = bearer.slice(sep + 1);
    if (!Number.isFinite(id) || !secret) return null;

    const record = await this.#retrieveTokenById(id);
    if (!record || record.token !== sha256(secret) || tokenExpired(record)) {
      return null;
    }

    const user = await this.#retrieveUserById(record.tokenable_id);
    if (!user) return null;

    request.user = user;
    request.accessTokenId = record.id;
    this.#accessTokens.set(request, record);
    this.#accessTokens.set(user, record);
    return user;
  }

  /** The access token behind a request, or behind the user resolved for it. */
  currentAccessToken(subject: object): AccessTokenRecord | null {
    return this.#accessTokens.get(subject) ?? null;
  }

  /** Whether the token behind `subject` (request or user) includes the ability (or `*`). */
  tokenCan(subject: object, ability: string): boolean {
    const token = this.#accessTokens.get(subject);
    if (!token) return false;
    return tokenAllows(token, ability);
  }

  /** Inverse of `tokenCan`. */
  tokenCant(subject: object, ability: string): boolean {
    return !this.tokenCan(subject, ability);
  }

  async check(request: Request): Promise<boolean> {
    return (await this.user(request)) !== null;
  }

  async guest(request: Request): Promise<boolean> {
    return !(await this.check(request));
  }

  async id(request: Request): Promise<string | number | null> {
    return (await this.user(request))?.id ?? null;
  }

  /** Whether a user was already resolved. */
  hasUser(request?: Request): boolean {
    return Boolean(request?.user);
  }

  /** Set the user for this request. */
  setUser(request: Request, user: Authenticatable): this {
    request.user = user;
    return this;
  }

  /** Forget the cached user. */
  forgetUser(request?: Request): this {
    if (request) {
      this.#accessTokens.delete(request);
      request.user = undefined;
      request.accessTokenId = undefined;
    }
    return this;
  }

  /** Ensure authenticated or throw 401. */
  async authenticate(request: Request): Promise<Authenticatable> {
    const user = await this.user(request);
    if (!user) abort(401, "Unauthenticated.");
    return user;
  }

  /**
   * Validate a bearer token string.
   * Accepts `{ token: "id|secret" }` or a plain token string via `api_token`.
   */
  async validate(credentials: {
    token?: string;
    api_token?: string;
    [key: string]: unknown;
  }): Promise<boolean> {
    const bearer = String(credentials.token ?? credentials.api_token ?? "");
    if (!bearer) return false;
    const sep = bearer.indexOf("|");
    if (sep === -1) return false;
    const id = Number(bearer.slice(0, sep));
    const secret = bearer.slice(sep + 1);
    if (!Number.isFinite(id) || !secret) return false;
    const record = await this.#retrieveTokenById(id);
    if (!record || record.token !== sha256(secret) || tokenExpired(record)) {
      return false;
    }
    const user = await this.#retrieveUserById(record.tokenable_id);
    return user !== null;
  }

  /** Revoke the token used on this request. */
  async logout(request: Request): Promise<void> {
    const tokenId = request.accessTokenId;
    if (tokenId !== undefined) {
      await this.#deleteTokenRecord(tokenId);
    }
    this.forgetUser(request);
  }

  /** Alias for logout. */
  async revoke(request: Request): Promise<void> {
    return this.logout(request);
  }
}

function defaultGuard(): TokenGuard {
  const guard = getTokenGuard();
  if (!guard) throw new Error("No token guard is registered.");
  return guard;
}

export function setTokenGuard(guard: TokenGuard): void {
  setDefaultTokenGuard(guard);
}

/** Methods `HasApiTokens` adds to a user model. Declare them with `interface User extends ApiTokenMethods {}`. */
export interface ApiTokenMethods {
  createToken(
    name?: string,
    abilities?: string[],
    expiresAt?: Date | number | null,
  ): Promise<string>;
  currentAccessToken(): AccessTokenRecord | null;
  tokenCan(ability: string): boolean;
  tokenCant(ability: string): boolean;
}

function apiTokenMethods(getGuard: () => TokenGuard): ApiTokenMethods {
  return {
    createToken(name = "api", abilities = ["*"], expiresAt) {
      return getGuard().createToken(this as unknown as Authenticatable, name, {
        abilities,
        expiresAt,
      });
    },
    currentAccessToken() {
      return getGuard().currentAccessToken(this);
    },
    tokenCan(ability) {
      return getGuard().tokenCan(this, ability);
    },
    tokenCant(ability) {
      return getGuard().tokenCant(this, ability);
    },
  } as ApiTokenMethods;
}

export type HasApiTokensOptions = {
  /** Token guard to use. Defaults to the registered one. */
  guard?: () => TokenGuard;
};

/**
 * Adds `createToken` / `currentAccessToken` / `tokenCan` / `tokenCant` to a user model,
 * delegating to the token guard.
 *
 * As a decorator (declare the types with `interface User extends ApiTokenMethods {}`):
 *
 * ```ts
 * @HasApiTokens()
 * export default class User extends Model {}
 * export default interface User extends ApiTokenMethods {}
 * ```
 *
 * As a mixin (typed automatically): `class User extends HasApiTokens(Model) {}`.
 */
export function HasApiTokens(options?: HasApiTokensOptions): ClassDecorator;
export function HasApiTokens<TBase extends new (...args: any[]) => object>(
  Base: TBase,
  getGuard?: () => TokenGuard,
): ReturnType<typeof apiTokensMixin<TBase>>;
export function HasApiTokens(
  baseOrOptions?: HasApiTokensOptions | (new (...args: any[]) => object),
  getGuard?: () => TokenGuard,
): unknown {
  if (typeof baseOrOptions === "function") {
    return apiTokensMixin(baseOrOptions, getGuard ?? defaultGuard);
  }
  const methods = apiTokenMethods(baseOrOptions?.guard ?? defaultGuard);
  return (target: Function) => installApiTokenMethods(target, methods);
}

function apiTokensMixin<TBase extends new (...args: any[]) => object>(
  Base: TBase,
  getGuard: () => TokenGuard,
) {
  class HasApiTokensHost extends Base {
    declare createToken: ApiTokenMethods["createToken"];
    declare currentAccessToken: ApiTokenMethods["currentAccessToken"];
    declare tokenCan: ApiTokenMethods["tokenCan"];
    declare tokenCant: ApiTokenMethods["tokenCant"];
  }
  installApiTokenMethods(HasApiTokensHost, apiTokenMethods(getGuard));
  return HasApiTokensHost;
}

/** Methods go on the prototype, so they never show up as model attributes. */
function installApiTokenMethods(target: Function, methods: ApiTokenMethods): void {
  for (const [name, method] of Object.entries(methods)) {
    Object.defineProperty(target.prototype, name, {
      value: method,
      configurable: true,
      writable: true,
    });
  }
}
