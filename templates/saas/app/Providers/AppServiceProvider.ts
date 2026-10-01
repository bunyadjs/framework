import { ServiceProvider } from "@bunyad/core";
import { Gate } from "@bunyad/auth";
import { Billing } from "@bunyad/billing";
import { registerMailable } from "@bunyad/mail";
import WelcomeMail from "@/Mail/WelcomeMail.ts";
import appConfig from "../../config/app.ts";

export default class AppServiceProvider extends ServiceProvider {
  register(): void {
    Billing.configure({
      key: appConfig.stripe.key,
      secret: appConfig.stripe.secret ?? "sk_test_local",
    });

    // Queued mail is revived by name on the worker.
    registerMailable(WelcomeMail);
  }

  boot(): void {
    // The first account is the admin. Replace with a role column when you need more.
    Gate.define("admin", (user) => user != null && Number(user.id) === 1);
  }
}
