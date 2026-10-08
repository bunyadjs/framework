// Type-level checks (verified by `tsc`, e.g. `bun run typecheck`); the runtime part is trivial.
import { expect, test } from "bun:test";
import { Model, type ColumnNames, type RelationNames } from "../src/index.ts";

class TnPost extends Model {
  static table = "tn_posts";
  declare id: number;
  declare title: string;
  declare views: number;
  comments() {
    return this.hasMany(TnComment, "post_id");
  }
  author() {
    return this.belongsTo(TnAuthor, "author_id");
  }
  helper(): string {
    return "not a relation";
  }
}
class TnComment extends Model {
  static table = "tn_comments";
  declare body: string;
}
class TnAuthor extends Model {
  static table = "tn_authors";
  declare name: string;
}

test("relation and column name helpers pick the right keys", () => {
  const rel: RelationNames<TnPost> = "comments";
  const rel2: RelationNames<TnPost> = "author";
  // @ts-expect-error `helper` returns a string, not a relation
  const notRel: RelationNames<TnPost> = "helper";
  // @ts-expect-error unknown relation
  const typo: RelationNames<TnPost> = "coments";

  const col: ColumnNames<TnPost> = "title";
  // @ts-expect-error methods are not columns
  const method: ColumnNames<TnPost> = "comments";
  // @ts-expect-error Model's own members are not columns
  const own: ColumnNames<TnPost> = "exists";

  expect([rel, rel2, notRel, typo, col, method, own]).toHaveLength(7);
});

test("query methods still accept dynamic strings", () => {
  const dynamic: string = "comments";
  TnPost.with(dynamic, "comments.author", "author");
  TnPost.where("title", "x").orderBy("views", "desc").whereIn("id", [1]);
  TnPost.where(`${dynamic}_count`, ">", 1);
});
