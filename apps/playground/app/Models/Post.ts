import { Model } from "@bunyad/orm";
import User from "./User.ts";

export default class Post extends Model {
  declare title: string;
  declare user_id: string | number;

  static table = "posts";

  user() {
    return this.belongsTo(User);
  }
}
