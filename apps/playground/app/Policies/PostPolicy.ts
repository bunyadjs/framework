import type { GateUser } from "@bunyad/auth";
import type Post from "../Models/Post.ts";

/** Owner-only write; anyone can view. */
export default class PostPolicy {
  view(_user: GateUser, _post: Post) {
    return true;
  }

  delete(user: GateUser, post: Post) {
    return user != null && Number(user.id) === Number(post.user_id);
  }
}
