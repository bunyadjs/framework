import { authorize } from "@bunyad/auth";
import type { Request } from "@bunyad/http";
import { Delete, Get, Middleware, Post as PostRoute, json } from "@bunyad/http";
import Post from "@/Models/Post.ts";
import User from "@/Models/User.ts";

export default class PostController {
  @PostRoute("/", { name: "posts.store" })
  async store(request: Request) {
    const data = await request.validate({
      user_id: "required|numeric",
      title: "required|string|min:3",
    });

    const user = await User.find(Number(data.user_id));
    if (!user) {
      return json({ message: "User not found" }, 404);
    }

    const post = await user.posts().create({ title: data.title });
    return json({ id: post.id, title: post.title, user_id: post.user_id }, 201);
  }

  @Get("/{post}", { name: "posts.show" })
  async show(request: Request, post: Post) {
    await authorize(request, "view", post);
    const author = await post.user().first();
    return json({
      id: post.id,
      title: post.title,
      user: author ? { id: author.id, name: author.name } : null,
    });
  }

  @Delete("/{post}", { name: "posts.destroy" })
  @Middleware("auth", "can:delete,post")
  async destroy(request: Request, post: Post) {
    await authorize(request, "delete", post);
    await post.delete();
    return json({ deleted: true });
  }
}
