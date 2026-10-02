import { AbstractProvider, type ProviderConfig } from "./abstract-provider.ts";
import { OAuthUser } from "./user.ts";
import type { FetchLike } from "./fetch-like.ts";

/**
 * GitLab OAuth 2 provider.
 */
export class GitlabProvider extends AbstractProvider {
  readonly #host: string;

  constructor(
    config: ProviderConfig & { host?: string },
    fetchImpl: FetchLike = fetch,
  ) {
    super(config, fetchImpl);
    this.#host = (config.host ?? "https://gitlab.com").replace(/\/$/, "");
    this.scopes(["read_user"]);
  }

  getAuthUrl(state: string | null): string {
    return this.buildAuthUrlFromBase(`${this.#host}/oauth/authorize`, state);
  }

  getTokenUrl(): string {
    return `${this.#host}/oauth/token`;
  }

  async getUserByToken(token: string): Promise<Record<string, unknown>> {
    const res = await this.getHttpClient()(`${this.#host}/api/v4/user`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`GitLab user request failed (${res.status}).`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  mapUserToObject(user: Record<string, unknown>): OAuthUser {
    return new OAuthUser().setRaw(user).map({
      id: String(user.id ?? ""),
      nickname: (user.username as string) ?? null,
      name: (user.name as string) ?? null,
      email: (user.email as string) ?? null,
      avatar: (user.avatar_url as string) ?? null,
    });
  }
}
