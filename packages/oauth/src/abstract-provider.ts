import { redirect } from "@bunyad/http";
import type { Request } from "@bunyad/http";
import { OAuthUser } from "./user.ts";
import type { FetchLike } from "./fetch-like.ts";

export type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirect: string;
  /** Optional provider host (e.g. self-hosted GitLab). */
  host?: string;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

/**
 * Base OAuth 2 provider.
 */
export abstract class AbstractProvider {
  #scopes: string[] = [];
  protected scopeSeparator = " ";
  protected parameters: Record<string, string> = {};
  #stateless = false;
  #request: Request | undefined;
  #fetch: FetchLike;

  constructor(
    protected config: ProviderConfig,
    fetchImpl: FetchLike = fetch,
  ) {
    this.#fetch = fetchImpl;
  }

  abstract getAuthUrl(state: string | null): string;
  abstract getTokenUrl(): string;
  abstract getUserByToken(token: string): Promise<Record<string, unknown>>;
  abstract mapUserToObject(user: Record<string, unknown>): OAuthUser;

  /**
   * Merge additional OAuth scopes.
   * Use `setScopes()` to replace.
   */
  scopes(scopes: string[]): this {
    for (const scope of scopes) {
      if (!this.#scopes.includes(scope)) this.#scopes.push(scope);
    }
    return this;
  }

  /** Replace OAuth scopes entirely. */
  setScopes(scopes: string[]): this {
    this.#scopes = [...scopes];
    return this;
  }

  getScopes(): string[] {
    return [...this.#scopes];
  }

  /** Override redirect URI for this provider instance. */
  redirectUrl(url: string): this {
    this.config = { ...this.config, redirect: url };
    return this;
  }

  /** Alias of `redirectUrl`. */
  setRedirectUrl(url: string): this {
    return this.redirectUrl(url);
  }

  with(parameters: Record<string, string>): this {
    this.parameters = { ...this.parameters, ...parameters };
    return this;
  }

  stateless(): this {
    this.#stateless = true;
    return this;
  }

  /** Bind the current HTTP request (needed for `user()` callback). */
  setRequest(request: Request): this {
    this.#request = request;
    return this;
  }

  redirect(): Response {
    const state = this.#stateless ? null : this.#generateState();
    return redirect(this.getAuthUrl(state));
  }

  async user(): Promise<OAuthUser> {
    const request = this.#requireRequest();
    const code = String(request.input("code") ?? "");
    if (!code) {
      throw new Error("OAuth authorization code is missing.");
    }
    if (!this.#stateless) {
      this.#validateState(request);
    }
    const token = await this.getAccessTokenResponse(code);
    const user = await this.userFromToken(token.access_token);
    user.setRefreshToken(token.refresh_token ?? null);
    user.setExpiresIn(token.expires_in ?? null);
    if (token.scope) {
      user.setApprovedScopes(
        token.scope.split(/[,\s]+/).filter(Boolean),
      );
    }
    return user;
  }

  async userFromToken(token: string): Promise<OAuthUser> {
    const raw = await this.getUserByToken(token);
    return this.mapUserToObject(raw).setToken(token);
  }

  async getAccessTokenResponse(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirect,
      grant_type: "authorization_code",
    });
    const res = await this.#fetch(this.getTokenUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`OAuth token request failed (${res.status}).`);
    }
    return (await res.json()) as TokenResponse;
  }

  protected buildAuthUrlFromBase(
    url: string,
    state: string | null,
  ): string {
    const u = new URL(url);
    u.searchParams.set("client_id", this.config.clientId);
    u.searchParams.set("redirect_uri", this.config.redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", this.#scopes.join(this.scopeSeparator));
    if (state) u.searchParams.set("state", state);
    for (const [key, value] of Object.entries(this.parameters)) {
      u.searchParams.set(key, value);
    }
    return u.toString();
  }

  protected getHttpClient(): FetchLike {
    return this.#fetch;
  }

  #requireRequest(): Request {
    if (!this.#request) {
      throw new Error("Call OAuth.setRequest(request) before user().");
    }
    return this.#request;
  }

  #generateState(): string {
    const state = crypto.randomUUID();
    const request = this.#request;
    request?.session?.put("socialite.state", state);
    return state;
  }

  #validateState(request: Request): void {
    const session = request.session;
    let sessionState: string | undefined;
    if (session?.pull) {
      sessionState = session.pull<string>("socialite.state");
    } else if (session) {
      sessionState = session.get<string>("socialite.state");
      session.forget("socialite.state");
    }
    const state = String(request.input("state") ?? "");
    if (!sessionState || !state || sessionState !== state) {
      throw new Error("Invalid OAuth state.");
    }
  }
}

export type ProviderFactory = (
  config: ProviderConfig,
  fetchImpl?: FetchLike,
) => AbstractProvider;
