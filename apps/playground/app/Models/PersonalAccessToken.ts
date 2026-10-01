import { Model } from "@bunyad/orm";

/**
 * Token-style personal access token row.
 * Use with `TokenGuard` instead of driver-specific raw SQL.
 */
export default class PersonalAccessToken extends Model {
  declare tokenable_type: string;
  declare tokenable_id: string | number;
  declare name: string;
  declare token: string;

  static table = "personal_access_tokens";
  static fillable = ["tokenable_type", "tokenable_id", "name", "token"];
}
