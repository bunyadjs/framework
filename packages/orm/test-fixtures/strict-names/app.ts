// Compiled by strict-names.test.ts. Lines ending in an ERROR marker comment must fail; every other line must compile.
import { Model, strict, unsafeName } from "../../src/index.ts";

class Post extends Model {
  static table = "posts";
  declare id: number;
  declare title: string;
  declare views: number;
  author() { return this.belongsTo(User, "author_id"); }
  comments() { return this.hasMany(Comment, "post_id"); }
  helper(): string { return "not a relation"; }
}
class User extends Model {
  static table = "users";
  declare name: string;
  posts() { return this.hasMany(Post, "author_id"); }
}
class Comment extends Model {
  static table = "comments";
  declare body: string;
}

// ── accepted ──
strict(Post).with("author", "comments");
strict(Post).with("comments.replies");              // nested path: the first segment is checked
strict(Post).with("comments as c");                 // alias
strict(Post).with({ comments: (q) => q.where("body", "x") });
strict(Post).whereHas("author", (q) => q.where("name", "Ada"));
strict(Post).has("comments").doesntHave("author");
strict(Post).where("title", "x").orderBy("views", "desc").whereIn("id", [1, 2]).whereNull("title");
strict(Post).where("title", "like", "%x").where((q) => q.where("views", ">", 1));
strict(Post).where("posts.title", "x");             // qualified column
strict(Post).with("author").with("comments").where("views", 1);   // chaining keeps the checks
strict(Post).with(unsafeName("anything" + Date.now()));
strict(Post).where(unsafeName("dynamic"), 1);
strict(Post).where("views", 1).limit(5).get();      // every other method still works
strict(Post).where("views", 1).orWhere("title", "x").count();
const lenient: string = "whatever";
Post.with(lenient);                                  // the normal API stays lenient

// ── rejected ──
strict(Post).with("autor");                         // ERROR relation typo
strict(Post).with("comments", "comment");           // ERROR relation typo (second argument)
strict(Post).whereHas("coments");                   // ERROR relation typo
strict(Post).has("authors");                        // ERROR relation typo
strict(Post).with("helper");                        // ERROR a method that is not a relation
strict(Post).where("titel", "x");                   // ERROR column typo
strict(Post).orderBy("view");                       // ERROR column typo
strict(Post).whereIn("idd", [1]);                   // ERROR column typo
strict(Post).where("views", 1).whereNull("tittle"); // ERROR typo later in a chain
strict(Post).with("author").where("naem", "x");     // ERROR typo after a strict call
