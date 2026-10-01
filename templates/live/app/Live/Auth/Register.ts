import { Auth, Registered } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { LiveComponent } from "@bunyad/live";
import { route } from "@bunyad/router";
import User from "@/Models/User.ts";

export default class Register extends LiveComponent {
  static layout = "layouts.auth";
  static title = "Register";

  name = "";
  email = "";
  password = "";
  password_confirmation = "";

  async register(): Promise<void> {
    const data = await this.validate({
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
    await Auth.login(request(), user);

    this.navigate(route("dashboard"));
  }

  view(): string {
    return "live.auth.register";
  }
}
