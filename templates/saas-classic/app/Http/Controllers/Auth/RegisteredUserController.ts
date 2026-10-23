import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, Registered } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { dispatch } from "@bunyad/queue";
import { route } from "@bunyad/router";
import { view } from "@bunyad/view";
import SendWelcomeEmailJob from "@/Jobs/SendWelcomeEmailJob.ts";
import User from "@/Models/User.ts";

export default class RegisteredUserController {
  create() {
    return view("auth.register", { title: "Register" });
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
    await dispatch(new SendWelcomeEmailJob(user.email));
    await Auth.login(request, user);

    return redirect(route("dashboard"));
  }
}
