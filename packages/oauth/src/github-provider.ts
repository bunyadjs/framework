import { AbstractProvider, type ProviderConfig } from "./abstract-provider.ts";
import { OAuthUser } from "./user.ts";

/**
 * GitHub OAuth 2 provider.
 */
export class GithubProvider extends AbstractProvider {
  constructor(config: ProviderConfig, fetchImpl: typeof fetch = fetch) {
    super(config, fetchImpl);
    this.scopes(["read:user", "user:email"]);
  }

  getAuthUrl(state: string | null): string {
    return this.buildAuthUrlFromBase(
      "https://github.com/login/oauth/authorize",
      state,
    );
  }

  getTokenUrl(): string {
    return "https://github.com/login/oauth/access_token";
  }

  async getUserByToken(token: string): Promise<Record<string, unknown>> {
    const res = await this.getHttpClient()("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Bunyad-OAuth",
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub user request failed (${res.status}).`);
    }
    const user = (await res.json()) as Record<string, unknown>;

    if (!user.email) {
      const emailsRes = await this.getHttpClient()(
        "https://api.github.com/user/emails",
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "Bunyad-OAuth",
          },
        },
      );
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as unknown;
        if (Array.isArray(emails)) {
          const list = emails as Array<{
            email: string;
            primary?: boolean;
            verified?: boolean;
          }>;
          const primary =
            list.find((e) => e.primary && e.verified) ??
            list.find((e) => e.primary) ??
            list[0];
          if (primary) user.email = primary.email;
        }
      }
    }

    return user;
  }

  mapUserToObject(user: Record<string, unknown>): OAuthUser {
    return new OAuthUser().setRaw(user).map({
      id: String(user.id ?? ""),
      nickname: (user.login as string) ?? null,
      name: (user.name as string) ?? null,
      email: (user.email as string) ?? null,
      avatar: (user.avatar_url as string) ?? null,
    });
  }
}
