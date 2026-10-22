import type { Request } from "@bunyad/http";
import { Middleware, redirect } from "@bunyad/http";
import { route } from "@bunyad/router";
import type User from "@/Models/User.ts";

/** Changing the password. View: `PasswordPage.tsx` (it needs no data, so there is no `edit()`). */
export default class PasswordController {
  @Middleware("throttle:6,1")
  async update(request: Request) {
    const { password } = await request.validate({
      current_password: "required|current_password",
      password: "required|string|confirmed|min:8",
    });

    const user = request.user as User;
    user.password = String(password);
    await user.save();

    return redirect(route("settings.password")).with("status", "password-updated");
  }
}
