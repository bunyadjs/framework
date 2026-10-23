import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, Registered } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { route } from "@bunyad/router";
import { Inertia } from "@bunyad/inertia";
import User from "@/Models/User.ts";

export default class RegisteredUserController {
  create() {
    return Inertia.render("auth/register");
  }

  async store(request: Request) {
    const data = await request.validate({
      name: "required|string|max:255",
      email: "required|string|lowercase|email|max:255|unique:users,email",
      password: "required|string|confirmed|min:8",
    });

    const user = await User.create({
      name: data.name,
      email: data.email,
      password: data.password,
    });

    await event(new Registered(user));
    await Auth.login(request, user);

    return redirect(route("dashboard"));
  }
}
