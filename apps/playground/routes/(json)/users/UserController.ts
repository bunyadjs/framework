import type { Request } from "@bunyad/http";
import { Get } from "@bunyad/http";
import UserResource from "@/Http/Resources/UserResource.ts";
import User from "@/Models/User.ts";

export default class UserController {
  async index(request: Request) {
    const page = Number(request.input("page") ?? 1);
    const perPage = Number(request.input("per_page") ?? 15);
    const paginator = await User.paginate(perPage, page, { path: "/users" });
    return UserResource.paginate(paginator);
  }

  @Get("/{user}", { name: "users.show" })
  show(user: User) {
    return UserResource.make(user).response();
  }

  @Get("/{user}/posts", { name: "users.posts" })
  async posts(user: User) {
    return Response.json({
      data: (await user.posts().get()).map((p) => ({
        id: p.id,
        title: p.title,
        user_id: p.user_id,
      })),
    });
  }
}
