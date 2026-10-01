import { AbstractProvider, type ProviderConfig } from "./abstract-provider.ts";
import { OAuthUser } from "./user.ts";

/**
 * Discord OAuth 2 provider.
 */
export class DiscordProvider extends AbstractProvider {
  constructor(config: ProviderConfig, fetchImpl: typeof fetch = fetch) {
    super(config, fetchImpl);
    this.scopes(["identify", "email"]);
  }

  getAuthUrl(state: string | null): string {
    return this.buildAuthUrlFromBase(
      "https://discord.com/api/oauth2/authorize",
      state,
    );
  }

  getTokenUrl(): string {
    return "https://discord.com/api/oauth2/token";
  }

  async getUserByToken(token: string): Promise<Record<string, unknown>> {
    const res = await this.getHttpClient()("https://discord.com/api/users/@me", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Discord user request failed (${res.status}).`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  mapUserToObject(user: Record<string, unknown>): OAuthUser {
    const id = String(user.id ?? "");
    const avatarHash = user.avatar as string | null | undefined;
    const avatar =
      id && avatarHash
        ? `https://cdn.discordapp.com/avatars/${id}/${avatarHash}.png`
        : null;
    return new OAuthUser().setRaw(user).map({
      id,
      nickname: (user.username as string) ?? null,
      name: (user.global_name as string) ?? (user.username as string) ?? null,
      email: (user.email as string) ?? null,
      avatar,
    });
  }
}
