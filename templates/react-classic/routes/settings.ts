import { Inertia } from "@bunyad/inertia";
import { redirect } from "@bunyad/http";
import { Route } from "@bunyad/router";
import PasswordController from "@/Http/Controllers/Settings/PasswordController.ts";
import ProfileController from "@/Http/Controllers/Settings/ProfileController.ts";
import TwoFactorController from "@/Http/Controllers/Settings/TwoFactorController.ts";

/** Account settings: profile, password, two-factor, and appearance. */
export default function (): void {
  Route.middleware("auth").group(() => {
    Route.get("/settings", () => redirect("/settings/profile")).name("settings");

    Route.get("/settings/profile", [ProfileController, "edit"]).name("settings.profile");
    Route.match(["put", "patch"], "/settings/profile", [ProfileController, "update"]).name("settings.profile.update");
    Route.delete("/settings/profile", [ProfileController, "destroy"]).name("settings.profile.destroy");

    Route.get("/settings/password", [PasswordController, "edit"]).name("settings.password");
    Route.match(["put", "patch"], "/settings/password", [PasswordController, "update"])
      .middleware("throttle:6,1")
      .name("settings.password.update");

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
      .name("settings.appearance");
  });
}
