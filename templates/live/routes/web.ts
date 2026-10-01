import { Live } from "@bunyad/live";
import { Route, type Router } from "@bunyad/router";
import authRoutes from "./auth.ts";
import settingsRoutes from "./settings.ts";

export default function (router: Router = Route): void {
  Route.middleware("web").group(() => {
    // `/live/update` and the Live client script.
    Live.routes(Route);

    Route.view("/", "welcome", { title: "Welcome" }).name("home");

    Route.view("/dashboard", "dashboard", { title: "Dashboard" })
      .middleware("auth", "verified")
      .name("dashboard");

    settingsRoutes();
    authRoutes();
  });
}
