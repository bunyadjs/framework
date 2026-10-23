import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Password } from "@bunyad/auth";
import { Inertia } from "@bunyad/inertia";

export default class PasswordResetLinkController {
  create() {
    return Inertia.render("auth/forgot-password");
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
