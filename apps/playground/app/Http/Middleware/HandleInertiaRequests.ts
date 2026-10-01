import type { Request } from "@bunyad/http";
import { Auth, csrf_token } from "@bunyad/auth";
import { Middleware } from "@bunyad/inertia";
import { createHash } from "node:crypto";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type VersionCache = { path: string; mtimeMs: number; version: string };

let versionCache: VersionCache | undefined;

/**
 * Share data with every Inertia response and configure the root template.
 */
export default class HandleInertiaRequests extends Middleware {
  protected override rootViewName = "app";

  override version(_request: Request): string | null {
    if (process.env.NODE_ENV === "test") return "1";
    const js = resolve(process.cwd(), "public/build/app.js");
    if (!existsSync(js)) return "dev";

    const mtimeMs = statSync(js).mtimeMs;
    if (
      versionCache &&
      versionCache.path === js &&
      versionCache.mtimeMs === mtimeMs
    ) {
      return versionCache.version;
    }

    const hash = createHash("sha1").update(readFileSync(js)).digest("hex");
    const version = hash.slice(0, 12);
    versionCache = { path: js, mtimeMs, version };
    return version;
  }

  override async share(request: Request) {
    const user = await Auth().user(request);
    return {
      appName: "Bunyad",
      csrf: request.session ? csrf_token(request) : "",
      auth: {
        user: user
          ? {
              id: user.id,
              name: String(user.name ?? ""),
              email: String(user.email ?? ""),
            }
          : null,
      },
      flash: {
        status: request.session?.get<string>("status") ?? null,
        error: request.session?.get<string>("error") ?? null,
      },
      errors:
        request.session?.get<Record<string, string[]>>("errors") ?? {},
    };
  }
}
