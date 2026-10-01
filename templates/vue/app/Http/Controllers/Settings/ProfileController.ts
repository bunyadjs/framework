import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth, isMustVerifyEmail } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { Inertia } from "@bunyad/inertia";
import type User from "@/Models/User.ts";
import ProfileUpdateRequest from "@/Http/Requests/Settings/ProfileUpdateRequest.ts";

export default class ProfileController {
  edit(request: Request) {
    const user = request.user as User;
    return Inertia.render("settings/profile", {
      mustVerifyEmail: isMustVerifyEmail(user) && !user.hasVerifiedEmail(),
    });
  }

  async update(request: ProfileUpdateRequest) {
    const user = request.user as User;
    const { name, email } = request.validated();

    // A new address has to be verified again.
    if (email !== user.email) user.email_verified_at = null;
    user.name = name;
    user.email = email;
    await user.save();

    return redirect(route("profile.edit")).with("status", "profile-updated");
  }

  async destroy(request: Request) {
    await request.validateWithBag("userDeletion", {
      password: "required|current_password",
    });
    const user = request.user as User;

    await Auth.logout(request);
    await user.delete();

    return redirect("/");
  }
}
