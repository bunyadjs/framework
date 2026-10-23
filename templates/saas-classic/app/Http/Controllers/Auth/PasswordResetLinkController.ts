import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Password } from "@bunyad/auth";
import { view } from "@bunyad/view";

export default class PasswordResetLinkController {
  create() {
    return view("auth.forgot-password", { title: "Forgot password" });
  }

  /** Always answers the same way, so the form does not reveal which emails have accounts. */
  async store(request: Request) {
    const { email } = await request.validate({ email: "required|email" });

    await Password.sendResetLink({ email: String(email) });

    return redirect()
      .back()
      .with("status", "A reset link will be sent if the account exists.");
  }
}
