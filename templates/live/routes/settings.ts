import { Live } from "@bunyad/live";
import { Route } from "@bunyad/router";

/** Account settings: profile, password, two-factor, and appearance. */
export default function (): void {
  Route.middleware("auth").group(() => {
    Route.redirect("/settings", "/settings/profile");

    Live.route("/settings/profile", "settings.profile").name("profile.edit");
    Live.route("/settings/password", "settings.password").name("password.edit");
    // Changing two-factor settings asks for the password again.
    Live.route("/settings/two-factor", "settings.two-factor")
      .middleware("password.confirm")
      .name("two-factor.show");

    Route.view("/settings/appearance", "settings.appearance", { title: "Appearance settings" })
      .name("appearance.edit");
  });
}
