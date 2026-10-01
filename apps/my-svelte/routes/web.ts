import { Inertia } from "@bunyad/inertia";
import { Route, type Router } from "@bunyad/router";
import authRoutes from "./auth.ts";
import settingsRoutes from "./settings.ts";

export default function (router: Router = Route): void {
  Route.middleware("web").group(() => {
    Inertia.route("/", "welcome").name("home");

    Inertia.route("/dashboard", "dashboard")
      .middleware("auth", "verified")
      .name("dashboard");

    settingsRoutes();
    authRoutes();
  });
}
