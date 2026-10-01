import { ServiceProvider } from "@bunyad/core";
import { Gate } from "@bunyad/auth";
import { Event } from "@bunyad/events";
import { Feature } from "@bunyad/features";
import { Head } from "@bunyad/head";
import UserRegistered from "../Events/UserRegistered.ts";
import SendWelcomeEmail from "../Listeners/SendWelcomeEmail.ts";

/**
 * Application bindings only. Framework packages boot via `bootFrameworkProviders`.
 */
export default class AppServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    Gate.define("admin", (user) => user != null && Number(user.id) === 1);

    Event.listen(UserRegistered, SendWelcomeEmail);

    Head.defaults((head) => {
      head
        .title("Bunyad", { suffix: " - Bunyad" })
        .description("Bunyad playground")
        .canonical()
        .og({ siteName: "Bunyad", type: "website" })
        .searchableByRobots();
    });

    Head.inertiaGlobals((head) => {
      head.viewport("width=device-width, initial-scale=1");
    });

    Feature.define("new-api", true);
    Feature.define("purchase-button", () => "seafoam-green");
    Feature.define("beta-dashboard", (scope: unknown) => {
      const user = scope as { id?: number | string } | null;
      return user != null && Number(user.id) === 1;
    });

  }
}
