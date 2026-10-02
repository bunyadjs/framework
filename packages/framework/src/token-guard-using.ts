import type { Authenticatable } from "@bunyad/auth";
import { TokenGuard } from "@bunyad/auth";
import type { Model } from "@bunyad/orm";

/**
 * Live `TokenGuard` to token + user models (dialect-safe).
 * Avoids raw SQL such as SQLite-only `last_insert_rowid()`.
 */
export function tokenGuardUsing(options: {
  Token: typeof Model;
  findUser: (
    id: string | number,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  tokenableType?: string;
  /** Find a user by `{ email }` (or any other credential column). */
  findUserByCredentials?: (
    credentials: Record<string, unknown>,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
}): TokenGuard {
  const Token = options.Token;
  const tokenableType = options.tokenableType ?? "User";

  return new TokenGuard({
    retrieveTokenById: async (id) => {
      const row = await Token.find(id);
      if (!row) return null;
      const attrs = row as unknown as {
        id: string | number;
        tokenable_id: string | number;
        name: string;
        token: string;
      };
      return {
        id: Number(attrs.id),
        tokenable_id: attrs.tokenable_id,
        name: attrs.name,
        token: attrs.token,
        abilities: (attrs as { abilities?: string }).abilities ?? "*",
        expires_at: (attrs as { expires_at?: number | null }).expires_at ?? null,
      };
    },
    retrieveUserById: options.findUser,
    retrieveUserByCredentials: options.findUserByCredentials,
    createTokenRecord: async (data) => {
      const row = await Token.create({
        tokenable_type: tokenableType,
        tokenable_id: data.tokenable_id,
        name: data.name,
        token: data.token,
        abilities: data.abilities ?? "*",
        expires_at: data.expires_at ?? null,
      });
      return Number((row as unknown as { id: string | number }).id);
    },
    deleteTokenRecord: async (id) => {
      const row = await Token.find(id);
      if (row) await row.delete();
    },
  });
}
