import { Model } from "@bunyad/orm";

/** Row behind `Auth.guard("token")`. Bunyad wires the guard to this model on boot. */
export default class PersonalAccessToken extends Model {
  declare tokenable_type: string;
  declare tokenable_id: string | number;
  declare name: string;
  declare token: string;
  declare abilities: string;
  declare expires_at: number | null;

  static table = "personal_access_tokens";
  static fillable = [
    "tokenable_type",
    "tokenable_id",
    "name",
    "token",
    "abilities",
    "expires_at",
  ];
}
