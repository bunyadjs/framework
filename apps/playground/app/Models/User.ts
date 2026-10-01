import type { Authenticatable } from "@bunyad/auth";
import { Authorizable, MustVerifyEmail } from "@bunyad/auth";
import { HasFactory, Model, ModelQuery, UseBuilder } from "@bunyad/orm";
import { databaseNotifications } from "@bunyad/notifications";
import Post from "./Post.ts";
import UserFactory from "../../database/factories/UserFactory.ts";

class UserQuery extends ModelQuery {
  byEmail(email: string) {
    return this.where("email", email);
  }
}

@UseBuilder(UserQuery)
@HasFactory(UserFactory)
@MustVerifyEmail()
export default class User extends Authorizable(Model) implements Authenticatable {
  declare name: string;
  declare email: string;
  declare password?: string;
  declare email_verified_at?: string | null;
  declare tenant_id?: string;

  static table = "users";
  static hidden = ["password"];

  /** Morph type for database notifications (not a DB column). */
  get notificationType(): string {
    return "User";
  }

  posts() {
    return this.hasMany(Post);
  }

  notifications() {
    return databaseNotifications(this);
  }
}

export { UserQuery };
