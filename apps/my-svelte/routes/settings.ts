import { Inertia } from "@bunyad/inertia";
import { Route } from "@bunyad/router";
import PasswordController from "@/Http/Controllers/Settings/PasswordController.ts";
import ProfileController from "@/Http/Controllers/Settings/ProfileController.ts";
import TwoFactorController from "@/Http/Controllers/Settings/TwoFactorController.ts";

/** Account settings: profile, password, two-factor, and appearance. */
export default function (): void {
  Route.middleware("auth").group(() => {
    Route.redirect("/settings", "/settings/profile");

    Route.get("/settings/profile", [ProfileController, "edit"]).name("profile.edit");
    Route.patch("/settings/profile", [ProfileController, "update"]).name("profile.update");
    Route.delete("/settings/profile", [ProfileController, "destroy"]).name("profile.destroy");

    Route.get("/settings/password", [PasswordController, "edit"]).name("password.edit");
    Route.put("/settings/password", [PasswordController, "update"])
      .middleware("throttle:6,1")
      .name("password.update");

    // Changing two-factor settings asks for the password again.
    Route.middleware("password.confirm").group(() => {
      Route.get("/settings/two-factor", [TwoFactorController, "show"]).name("two-factor.show");
      Route.post("/settings/two-factor", [TwoFactorController, "store"]).name("two-factor.enable");
      Route.post("/settings/two-factor/confirm", [TwoFactorController, "confirm"]).name("two-factor.confirm");
      Route.delete("/settings/two-factor", [TwoFactorController, "destroy"]).name("two-factor.disable");
      Route.post("/settings/two-factor/recovery-codes", [TwoFactorController, "regenerateRecoveryCodes"])
        .name("two-factor.recovery-codes");
    });

    Inertia.route("/settings/appearance", "settings/appearance")
      .name("appearance.edit");
  });
}
