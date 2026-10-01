import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, markPasswordConfirmed } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import { view } from "@bunyad/view";
import type User from "@/Models/User.ts";

export default class ConfirmablePasswordController {
  show() {
    return view("auth.confirm-password", { title: "Confirm password" });
  }

  async store(request: Request) {
    const { password } = await request.validate({ password: "required|string" });
    const user = request.user as User;

    if (!(await Auth.validate({ email: user.email, password: String(password) }))) {
      throw ValidationException.withMessages({
        password: "The provided password is incorrect.",
      });
    }

    await markPasswordConfirmed(request);

    return redirect().intended(route("dashboard"));
  }
}
