import { Route, type Router } from "@bunyad/router";
import AdminController from "@/Http/Controllers/AdminController.ts";
import BillingController from "@/Http/Controllers/BillingController.ts";
import authRoutes from "./auth.ts";
import settingsRoutes from "./settings.ts";

export default function (router: Router = Route): void {
  Route.middleware("web").group(() => {
    Route.view("/", "welcome", { title: "Welcome" }).name("home");

    Route.view("/dashboard", "dashboard", { title: "Dashboard" })
      .middleware("auth", "verified")
      .name("dashboard");

    Route.middleware("auth").group(() => {
      Route.get("/billing", [BillingController, "show"]).name("billing");
      Route.post("/billing/upgrade", [BillingController, "upgrade"]).name("billing.upgrade");
      Route.post("/billing/portal", [BillingController, "portal"]).name("billing.portal");
    });

    Route.get("/admin", [AdminController, "index"]).middleware("auth", "can:admin").name("admin");

    settingsRoutes();
    authRoutes();
  });
}
