import { FormRequest } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import { ValidationException } from "@bunyad/validation";
import type User from "@/Models/User.ts";

type Credentials = { email: string; password: string; name?: string | null };

export default class IssueTokenRequest extends FormRequest<Credentials> {
  authorize() {
    return true;
  }

  rules() {
    return {
      email: "required|email",
      password: "required|string",
      name: "nullable|string|max:255",
    };
  }

  /** The user for the given credentials, or a 422 on `email`. */
  async authenticate(): Promise<User> {
    const { email, password } = this.validated();
    const user = await Auth.guard("token").attempt({ email, password });

    if (!user) {
      throw ValidationException.withMessages({
        email: "These credentials do not match our records.",
      });
    }

    return user as User;
  }

  tokenName(): string {
    return this.validated("name") || "api";
  }
}
