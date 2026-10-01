import type { ApiTokenMethods, Authenticatable } from "@bunyad/auth";
import { Authorizable, HasApiTokens } from "@bunyad/auth";
import { Model } from "@bunyad/orm";
import PersonalAccessToken from "@/Models/PersonalAccessToken.ts";
import UserFactory from "@database/factories/UserFactory.ts";

@HasApiTokens()
export default class User extends Authorizable(Model) implements Authenticatable {
  declare name: string;
  declare email: string;
  declare password?: string;

  static table = "users";
  static fillable = ["name", "email", "password"];
  static hidden = ["password"];
  static casts = { password: "hashed" } as const;

  static factory() {
    return new UserFactory();
  }

  tokens() {
    return this.hasMany(PersonalAccessToken, "tokenable_id");
  }
}

export default interface User extends ApiTokenMethods {}
