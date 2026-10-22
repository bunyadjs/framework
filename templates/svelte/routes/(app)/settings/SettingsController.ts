import { Get, redirect } from "@bunyad/http";
import { route } from "@bunyad/router";

/** The settings area. Its pages have controllers of their own (`profile/`, `password/`, `two-factor/`). */
export default class SettingsController {
  /** `/settings` opens the profile page. */
  @Get("/", { name: "settings" })
  home() {
    return redirect(route("settings.profile"));
  }
}
