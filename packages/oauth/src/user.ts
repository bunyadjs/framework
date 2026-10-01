export type OAuthUserMap = {
  id: string;
  nickname?: string | null;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
};

/**
 * Normalized OAuth user (`OAuth::user()`).
 */
export class OAuthUser {
  id = "";
  nickname: string | null = null;
  name: string | null = null;
  email: string | null = null;
  avatar: string | null = null;
  token = "";
  refreshToken: string | null = null;
  expiresIn: number | null = null;
  approvedScopes: string[] = [];
  #raw: Record<string, unknown> = {};

  setRaw(raw: Record<string, unknown>): this {
    this.#raw = raw;
    return this;
  }

  getRaw(): Record<string, unknown> {
    return this.#raw;
  }

  map(fields: OAuthUserMap): this {
    this.id = String(fields.id);
    this.nickname = fields.nickname ?? null;
    this.name = fields.name ?? null;
    this.email = fields.email ?? null;
    this.avatar = fields.avatar ?? null;
    return this;
  }

  setToken(token: string): this {
    this.token = token;
    return this;
  }

  setRefreshToken(token: string | null): this {
    this.refreshToken = token;
    return this;
  }

  setExpiresIn(seconds: number | null): this {
    this.expiresIn = seconds;
    return this;
  }

  setApprovedScopes(scopes: string[]): this {
    this.approvedScopes = scopes;
    return this;
  }

  getId(): string {
    return this.id;
  }

  getNickname(): string | null {
    return this.nickname;
  }

  getName(): string | null {
    return this.name;
  }

  getEmail(): string | null {
    return this.email;
  }

  getAvatar(): string | null {
    return this.avatar;
  }
}
