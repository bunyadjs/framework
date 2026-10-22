import type { Request } from "@bunyad/http";
import { Middleware, redirect } from "@bunyad/http";
import { Hash } from "@bunyad/auth";
import { broadcast } from "@bunyad/broadcasting";
import { event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";
import UserRegisteredBroadcast from "@/Events/UserRegisteredBroadcast.ts";
import RegisterRequest from "@/Http/Requests/RegisterRequest.ts";
import User from "@/Models/User.ts";

export default class RegisterController {
  @Middleware("throttle:auth")
  async store(request: Request) {
    const form = await RegisterRequest.from(request);
    const data = form.validated();

    const user = await User.create({
      name: data.name,
      email: data.email,
      password: await Hash.make(String(data.password)),
      tenant_id: "demo",
    });

    await event(new UserRegistered(user));
    await broadcast(new UserRegisteredBroadcast(user));

    form.session?.flash("status", "Account created. Please log in.");
    return redirect("/login");
  }
}
