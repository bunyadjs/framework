import { AbstractProvider, type ProviderConfig } from "./abstract-provider.ts";
import { OAuthUser } from "./user.ts";
import type { FetchLike } from "./fetch-like.ts";

/**
 * Google OAuth 2 provider.
 */
export class GoogleProvider extends AbstractProvider {
  constructor(config: ProviderConfig, fetchImpl: FetchLike = fetch) {
    super(config, fetchImpl);
    this.scopes(["openid", "profile", "email"]);
  }

  getAuthUrl(state: string | null): string {
    return this.buildAuthUrlFromBase(
      "https://accounts.google.com/o/oauth2/v2/auth",
      state,
    );
  }

  getTokenUrl(): string {
    return "https://oauth2.googleapis.com/token";
  }

  async getUserByToken(token: string): Promise<Record<string, unknown>> {
    const res = await this.getHttpClient()(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Google user request failed (${res.status}).`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  mapUserToObject(user: Record<string, unknown>): OAuthUser {
    return new OAuthUser().setRaw(user).map({
      id: String(user.sub ?? ""),
      nickname: (user.name as string) ?? null,
      name: (user.name as string) ?? null,
      email: (user.email as string) ?? null,
      avatar: (user.picture as string) ?? null,
    });
  }
}
