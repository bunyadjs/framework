import type { Request } from "@bunyad/http";
import { redirect, Middleware, Name, Post } from "@bunyad/http";
import type User from "@/Models/User.ts";
import appConfig from "../../../config/app.ts";

@Middleware("auth")
export default class BillingController {
  @Name("billing")
  async show(request: Request) {
    const user = request.user as User;
    const subscribed = await user.subscribed();
    return {
      plan: subscribed ? "pro" : "free",
      subscribed,
      hasStripeId: user.hasStripeId(),
      checkout: request.query().checkout,
    };
  }

  /** Start Stripe Checkout for the Pro subscription. */
  @Post("/upgrade")
  @Name("billing.upgrade")
  async upgrade(request: Request) {
    const user = request.user as User;
    if (await user.subscribed()) {
      request.session?.flash("status", "You are already on Pro.");
      return redirect("/billing");
    }

    const base = appConfig.url.replace(/\/$/, "");
    const session = await user
      .newSubscription("default", appConfig.stripe.pricePro)
      .checkout({
        success_url: `${base}/billing?checkout=success`,
        cancel_url: `${base}/billing?checkout=cancel`,
      });

    if (!session.url) {
      request.session?.flash("error", "Could not start Checkout.");
      return redirect("/billing");
    }

    return redirect(session.url);
  }

  /** Stripe Customer Billing Portal. */
  @Post("/portal")
  @Name("billing.portal")
  async portal(request: Request) {
    const user = request.user as User;
    const returnUrl = `${appConfig.url.replace(/\/$/, "")}/billing`;
    const url = await user.redirectToBillingPortal(returnUrl);
    return redirect(url);
  }
}
