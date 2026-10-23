import { Live } from "@bunyad/live-components";
import { redirect } from "@bunyad/http";
import { Route } from "@bunyad/router";

/** Account settings: profile, password, two-factor, and appearance. */
export default function (): void {
  Route.middleware("auth").group(() => {
    Route.get("/settings", () => redirect("/settings/profile")).name("settings");

    Live.route("/settings/profile", "settings.profile").name("settings.profile");
    Live.route("/settings/password", "settings.password").name("settings.password");
    // Changing two-factor settings asks for the password again.
    Live.route("/settings/two-factor", "settings.two-factor")
      .middleware("password.confirm")
      .name("two-factor.show");

    Route.view("/settings/appearance", "settings.appearance", { title: "Appearance settings" })
      .name("settings.appearance");
  });
}
