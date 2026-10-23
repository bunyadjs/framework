import { FormRequest } from "@bunyad/http";
import { Rule } from "@bunyad/validation";
import type User from "@/Models/User.ts";

type Profile = { name: string; email: string };

export default class ProfileUpdateRequest extends FormRequest<Profile> {
  authorize() {
    return true;
  }

  rules() {
    const user = this.user as User;
    return {
      name: "required|string|max:255",
      email: [
        "required",
        "string",
        "lowercase",
        "email",
        "max:255",
        Rule.unique("users", "email").ignore(user.id),
      ],
    };
  }
}
