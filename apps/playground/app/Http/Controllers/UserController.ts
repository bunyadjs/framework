import type { Request } from "@bunyad/http";
import { Hash } from "@bunyad/auth";
import StoreUserRequest from "../Requests/StoreUserRequest.ts";
import UserResource from "../Resources/UserResource.ts";
import User from "../../Models/User.ts";

export default class UserController {
  async index(request: Request) {
    const page = Number(request.input("page") ?? 1);
    const perPage = Number(request.input("per_page") ?? 15);
    const paginator = await User.paginate(perPage, page, { path: "/users" });
    return UserResource.paginate(paginator);
  }

  show(user: User) {
    return UserResource.make(user).response();
  }

  async store(request: Request) {
    const form = await StoreUserRequest.from(request);
    const data = form.validated();

    const user = await User.create({
      name: data.name,
      email: data.email,
      password: await Hash.make("password"),
    });

    form.session?.flash("status", `Created ${user.name}`);

    return UserResource.make(user).response(201);
  }

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
