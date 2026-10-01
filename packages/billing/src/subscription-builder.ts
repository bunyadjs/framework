import {
  Billing,
  getStripeId,
  ownerId,
  persistOwner,
  setPaymentMethod,
  setStripeId,
} from "./billing.ts";
import { Subscription } from "./subscription.ts";
import type { BillableOwner, StripeCheckoutSession } from "./types.ts";

/**
 * Fluent builder for `newSubscription(...).create()` / `checkout()`.
 */
export class SubscriptionBuilder {
  #owner: BillableOwner;
  #type: string;
  #prices: string[];
  #quantity = 1;
  #trialDays: number | null = null;
  #allowPromotionCodes = false;

  constructor(owner: BillableOwner, type: string, prices: string | string[]) {
    this.#owner = owner;
    this.#type = type;
    this.#prices = Array.isArray(prices) ? prices : [prices];
  }

  quantity(value: number): this {
    this.#quantity = value;
    return this;
  }

  trialDays(days: number): this {
    this.#trialDays = days;
    return this;
  }

  allowPromotionCodes(): this {
    this.#allowPromotionCodes = true;
    return this;
  }

  /** Create the Stripe subscription and persist a local row. */
  async create(paymentMethod: string | null = null): Promise<Subscription> {
    const customerId = await this.#ensureCustomer();

    if (paymentMethod) {
      await Billing.stripe()
        .request(`/v1/payment_methods/${paymentMethod}/attach`, {
          form: { customer: customerId },
        })
        .catch(() => undefined);
      await Billing.stripe().updateCustomer(customerId, {
        "invoice_settings[default_payment_method]": paymentMethod,
      });
      setPaymentMethod(this.#owner, "card", null);
      await persistOwner(this.#owner);
    }

    const form: Record<string, string | number | boolean> = {
      customer: customerId,
      "items[0][price]": this.#prices[0]!,
      "items[0][quantity]": this.#quantity,
      "metadata[type]": this.#type,
      "metadata[name]": this.#type,
    };
    for (let i = 1; i < this.#prices.length; i++) {
      form[`items[${i}][price]`] = this.#prices[i]!;
      form[`items[${i}][quantity]`] = this.#quantity;
    }
    if (paymentMethod) {
      form.default_payment_method = paymentMethod;
    }
    if (this.#trialDays != null) {
      form.trial_period_days = this.#trialDays;
    }
    if (Billing.calculatesTaxes()) {
      form["automatic_tax[enabled]"] = true;
    }

    const stripe = await Billing.stripe().createSubscription(form);
    const price =
      stripe.items?.data?.[0]?.price?.id ?? this.#prices[0] ?? null;
    const trialEndsAt = stripe.trial_end
      ? new Date(stripe.trial_end * 1000)
      : null;
    const row = {
      type: this.#type,
      stripeId: stripe.id,
      stripeStatus: stripe.status,
      stripePrice: price,
      quantity: this.#quantity,
      trialEndsAt,
      endsAt: null as Date | null,
    };
    await Billing.subscriptions().save(ownerId(this.#owner), row);
    return new Subscription(this.#owner, row);
  }

  /** Stripe Checkout session for this subscription. */
  async checkout(
    sessionOptions: {
      success_url?: string;
      cancel_url?: string;
      [key: string]: unknown;
    } = {},
  ): Promise<StripeCheckoutSession> {
    const customerId = await this.#ensureCustomer();
    const form: Record<string, string | number | boolean> = {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": this.#prices[0]!,
      "line_items[0][quantity]": this.#quantity,
      success_url: String(
        sessionOptions.success_url ?? "http://localhost/billing/success",
      ),
      cancel_url: String(
        sessionOptions.cancel_url ?? "http://localhost/billing/cancel",
      ),
      "subscription_data[metadata][type]": this.#type,
    };
    if (this.#trialDays != null) {
      form["subscription_data[trial_period_days]"] = this.#trialDays;
    }
    if (this.#allowPromotionCodes) {
      form.allow_promotion_codes = true;
    }
    if (Billing.calculatesTaxes()) {
      form["automatic_tax[enabled]"] = true;
    }
    for (const [key, value] of Object.entries(sessionOptions)) {
      if (key === "success_url" || key === "cancel_url") continue;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        form[key] = value;
      }
    }
    return Billing.stripe().createCheckoutSession(form);
  }

  async #ensureCustomer(): Promise<string> {
    const existing = getStripeId(this.#owner);
    if (existing) return existing;
    const customer = await Billing.stripe().createCustomer({
      email: this.#owner.email ?? undefined,
      name: this.#owner.name ?? undefined,
    });
    setStripeId(this.#owner, customer.id);
    await persistOwner(this.#owner);
    return customer.id;
  }
}
