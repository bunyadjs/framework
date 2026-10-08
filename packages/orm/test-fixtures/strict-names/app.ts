// Compiled by strict-names.test.ts with the default settings. Lines ending in an ERROR marker comment must fail; every other line must compile.
import { Model, unsafeName, type OrmCollection } from "../../src/index.ts";

// No configuration: strict names are the default.
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

// Relations described by `static relations` + declared properties (no relation methods).
class Article extends Model {
  static table = "articles";
  declare id: number;
  declare title: string;
  declare comments: OrmCollection<Comment>;
  declare author: User | null;
  static relations = {
    comments: (m: Article) => m.hasMany(Comment, "article_id"),
    author: (m: Article) => m.belongsTo(User, "author_id"),
  };
}
static_check: {
  Article.with("comments", "author", "comments.replies");
  Article.whereHas("comments").where("title", "x");
  Article.with("coments");                          // ERROR typo in a declared-property relation
  Article.with("title");                            // ERROR a column is not a relation
}

// ── accepted ──
Post.with("author", "comments");
Post.with("comments.replies");              // nested path: the first segment is checked
Post.with("comments as c");                 // alias
Post.with({ comments: (q) => q.where("body", "x") });
Post.whereHas("author", (q) => q.where("name", "Ada"));
Post.has("comments").doesntHave("author");
Post.where("title", "x").orderBy("views", "desc").whereIn("id", [1, 2]).whereNull("title");
Post.where("title", "like", "%x").where((q) => q.where("views", ">", 1));
Post.where("posts.title", "x");             // qualified column
Post.with("author").with("comments").where("views", 1);   // chaining keeps the checks
Post.with(unsafeName("anything" + Date.now()));
Post.where(unsafeName("dynamic"), 1);
Post.where("views", 1).limit(5).get();      // every other method still works
Post.where("views", 1).orWhere("title", "x").count();

// ── rejected ──
Post.with("autor");                         // ERROR relation typo
Post.with("comments", "comment");           // ERROR relation typo (second argument)
Post.whereHas("coments");                   // ERROR relation typo
Post.has("authors");                        // ERROR relation typo
Post.with("helper");                        // ERROR a method that is not a relation
Post.where("titel", "x");                   // ERROR column typo
Post.orderBy("view");                       // ERROR column typo
Post.whereIn("idd", [1]);                   // ERROR column typo
Post.where("views", 1).whereNull("tittle"); // ERROR typo later in a chain
Post.with("author").where("naem", "x");     // ERROR typo after a strict call
