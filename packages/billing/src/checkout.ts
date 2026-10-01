import { Billing, getStripeId, persistOwner, setStripeId } from "./billing.ts";
import type { BillableOwner, StripeCheckoutSession } from "./types.ts";

/**
 * Guest / customer Checkout helpers (`Checkout.customer(user)`).
 */
export const Checkout = {
  customer(owner: BillableOwner): CheckoutBuilder {
    return new CheckoutBuilder(owner);
  },

  guest(): CheckoutBuilder {
    return new CheckoutBuilder(null);
  },
};

export class CheckoutBuilder {
  #owner: BillableOwner | null;
  #items: Array<{ price: string; quantity: number }> = [];
  #mode: "payment" | "subscription" | "setup" = "payment";
  #allowPromotionCodes = false;

  constructor(owner: BillableOwner | null) {
    this.#owner = owner;
  }

  lineItem(price: string, quantity = 1): this {
    this.#items.push({ price, quantity });
    return this;
  }

  mode(value: "payment" | "subscription" | "setup"): this {
    this.#mode = value;
    return this;
  }

  allowPromotionCodes(): this {
    this.#allowPromotionCodes = true;
    return this;
  }

  async create(
    sessionOptions: {
      success_url?: string;
      cancel_url?: string;
      [key: string]: unknown;
    } = {},
  ): Promise<StripeCheckoutSession> {
    if (this.#items.length === 0) {
      throw new Error("Checkout requires at least one lineItem().");
    }
    const form: Record<string, string | number | boolean> = {
      mode: this.#mode,
      success_url:
        String(sessionOptions.success_url ?? "http://localhost/checkout/success"),
      cancel_url:
        String(sessionOptions.cancel_url ?? "http://localhost/checkout/cancel"),
    };
    if (this.#allowPromotionCodes) form.allow_promotion_codes = true;
    if (Billing.calculatesTaxes()) form["automatic_tax[enabled]"] = true;

    if (this.#owner) {
      let customerId = getStripeId(this.#owner);
      if (!customerId) {
        const customer = await Billing.stripe().createCustomer({
          email: this.#owner.email ?? undefined,
          name: this.#owner.name ?? undefined,
        });
        customerId = customer.id;
        setStripeId(this.#owner, customerId);
        await persistOwner(this.#owner);
      }
      form.customer = customerId;
    }

    this.#items.forEach((item, i) => {
      form[`line_items[${i}][price]`] = item.price;
      form[`line_items[${i}][quantity]`] = item.quantity;
    });

    return Billing.stripe().createCheckoutSession(form);
  }
}
