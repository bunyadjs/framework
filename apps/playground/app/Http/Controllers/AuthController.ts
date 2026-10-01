import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, Hash } from "@bunyad/auth";
import { broadcast } from "@bunyad/broadcasting";
import { event } from "@bunyad/events";
import { inertia } from "@bunyad/inertia";
import UserRegistered from "../../Events/UserRegistered.ts";
import UserRegisteredBroadcast from "../../Events/UserRegisteredBroadcast.ts";
import LoginRequest from "../Requests/LoginRequest.ts";
import RegisterRequest from "../Requests/RegisterRequest.ts";
import User from "../../Models/User.ts";
export default class AuthController {
  async showLogin(request: Request) {
    const old = request.session?.get<Record<string, unknown>>("_old") ?? {};
    return inertia("Auth/Login", {
      email: typeof old.email === "string" ? old.email : "",
    });
  }

  async showRegister(_request: Request) {
    return inertia("Auth/Register");
  }

  async login(request: Request) {
    const form = await LoginRequest.from(request);
    const data = form.validated();

    const ok = await Auth().attempt(
      form,
      String(data.email),
      String(data.password),
    );

    if (!ok) {
      form.session?.flash("error", "Invalid credentials.");
      form.session?.flash("_old", { email: data.email });
      return redirect("/login");
    }

    return redirect("/dashboard");
  }

  async logout(request: Request) {
    await Auth().logout(request);
    return redirect("/login");
  }

  async dashboard(request: Request) {
    const user = await Auth().user(request);
    return inertia("Auth/Dashboard", {
      name: String(user!.name ?? user!.email),
    });
  }

  async register(request: Request) {
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
