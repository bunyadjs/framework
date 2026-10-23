import type { Request } from "@bunyad/http";
import { Hash } from "@bunyad/auth";
import StoreUserRequest from "@/Http/Requests/StoreUserRequest.ts";
import UserResource from "@/Http/Resources/UserResource.ts";
import User from "@/Models/User.ts";

export default class UserController {
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
}
