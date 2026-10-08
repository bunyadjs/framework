// Compiled by strict-names.test.ts with strict names switched off. Every line must compile.
import { Model } from "../../src/index.ts";

declare module "../../src/index.ts" {
  interface OrmTypeOptions {
    strictNames: false;
  }
}

class Post extends Model {
  static table = "posts";
  declare title: string;
  author() { return this.belongsTo(Post, "author_id"); }
}

const dynamic: string = "anything";
Post.with("author", "autor", dynamic);       // any string is accepted again
Post.where("titel", "x").orderBy(dynamic);
Post.whereHas("nope").has("also-nope");
