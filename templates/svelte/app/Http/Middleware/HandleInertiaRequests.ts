import { existsSync, statSync } from "node:fs";
import { Auth } from "@bunyad/auth";
import type { Request } from "@bunyad/http";
import { Middleware } from "@bunyad/inertia";
import type User from "@/Models/User.ts";

/**
 * Props every page gets, the root view, and the asset version. Validation
 * errors are shared by the base class.
 */
export default class HandleInertiaRequests extends Middleware {
  protected override rootViewName = "app";

  /** Changes when the bundle is rebuilt, so open tabs reload onto the new assets. */
  override version(): string | null {
    const bundle = "public/build/app.js";
    return existsSync(bundle) ? String(Math.floor(statSync(bundle).mtimeMs)) : null;
  }

  override async share(request: Request) {
    // Runs before route middleware, so resolve the user here rather than reading `request.user`.
    const user = (await Auth.user(request)) as User | null;
    return {
      name: config<string>("app.name"),
      auth: {
        user: user ? { id: user.id, name: user.name, email: user.email, initials: user.initials() } : null,
      },
      status: request.session?.get<string>("status") ?? null,
    };
  }
}
