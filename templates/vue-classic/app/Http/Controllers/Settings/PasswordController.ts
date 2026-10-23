import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { route } from "@bunyad/router";
import { Inertia } from "@bunyad/inertia";
import type User from "@/Models/User.ts";

export default class PasswordController {
  edit() {
    return Inertia.render("settings/password");
  }

  async update(request: Request) {
    const { password } = await request.validate({
      current_password: "required|current_password",
      password: "required|string|confirmed|min:8",
    });

    const user = request.user as User;
    user.password = String(password);
    await user.save();

    return redirect(route("password.edit")).with("status", "password-updated");
  }
}
