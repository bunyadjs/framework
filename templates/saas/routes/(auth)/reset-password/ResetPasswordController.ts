import type { Request } from "@bunyad/http";
import { Name, redirect } from "@bunyad/http";
import { Password, PasswordReset } from "@bunyad/auth";
import { event } from "@bunyad/events";
import { route } from "@bunyad/router";
import type User from "@/Models/User.ts";

const failures: Record<string, string> = {
  [Password.InvalidToken]: "This password reset link is invalid or has expired.",
  [Password.InvalidUser]: "We can't find a user with that email address.",
};

/** Choosing a new password from the link in the reset mail. View: `[token]/ResetPasswordPage.tsx`. */
export default class ResetPasswordController {
  /** The mail links here. Its props are the token and the email from the link. */
  @Name("password.reset")
  show(request: Request) {
    return {
      token: request.route("token"),
      email: request.query().email,
    };
  }

  @Name("password.store")
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
