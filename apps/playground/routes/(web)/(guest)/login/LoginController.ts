import type { Request } from "@bunyad/http";
import { Middleware, Name, redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import LoginRequest from "@/Http/Requests/LoginRequest.ts";

export default class LoginController {
  /** Props of `LoginPage.tsx`. */
  create(request: Request) {
    const old = request.session?.get<Record<string, unknown>>("_old") ?? {};
    return { email: typeof old.email === "string" ? old.email : "" };
  }

  @Name("login.attempt")
  @Middleware("throttle:auth")
  async store(request: Request) {
    const form = await LoginRequest.from(request);
    const data = form.validated();

    const ok = await Auth().attempt(form, String(data.email), String(data.password));

    if (!ok) {
      form.session?.flash("error", "Invalid credentials.");
      form.session?.flash("_old", { email: data.email });
      return redirect("/login");
    }

    return redirect("/dashboard");
  }
}
