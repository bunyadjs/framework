import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Password, PasswordReset } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { route } from "@bunyad/router";
import { Inertia } from "@bunyad/inertia";
import type User from "@/Models/User.ts";

const failures: Record<string, string> = {
  [Password.InvalidToken]: "This password reset link is invalid or has expired.",
  [Password.InvalidUser]: "We can't find a user with that email address.",
};

export default class NewPasswordController {
  create(request: Request) {
    return Inertia.render("auth/reset-password", {
      token: request.route("token"),
      email: request.query().email,
    });
  }

  async store(request: Request) {
    const data = await request.validate({
      token: "required",
      email: "required|email",
      password: "required|string|confirmed|min:8",
    });

    const status = await Password.reset(
      {
        email: String(data.email),
        password: String(data.password),
        token: String(data.token),
      },
      async (user) => {
        const model = user as User;
        model.password = String(data.password);
        // Signs out every "remember me" device.
        model.remember_token = null;
        await model.save();
        await event(new PasswordReset(model));
      },
    );

    if (status === Password.PasswordReset) {
      return redirect(route("login")).with("status", "Your password has been reset.");
    }

    return redirect()
      .back()
      .withInput({ email: data.email })
      .withErrors({ email: [failures[status] ?? "Unable to reset your password."] });
  }
}
