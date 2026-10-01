import {
  Billing,
  ownerId,
  persistOwner,
  toDate,
} from "./billing.ts";
import type { BillableOwner, SubscriptionAttributes } from "./types.ts";

/**
 * Local subscription record with Billing status helpers.
 */
export class Subscription {
  #owner: BillableOwner;
  #attrs: SubscriptionAttributes;
  #noProrate = false;

  constructor(owner: BillableOwner, attrs: SubscriptionAttributes) {
    this.#owner = owner;
    this.#attrs = { ...attrs };
  }

  get type(): string {
    return this.#attrs.type;
  }

  get stripeId(): string {
    return this.#attrs.stripeId;
  }

  get stripeStatus(): string {
    return this.#attrs.stripeStatus;
  }

  get stripePrice(): string | null {
    return this.#attrs.stripePrice;
  }

  get quantity(): number {
    return this.#attrs.quantity;
  }

  asStripeSubscription() {
    return Billing.stripe().request(`/v1/subscriptions/${this.stripeId}`);
  }

  valid(): boolean {
    return this.active() || this.onTrial() || this.onGracePeriod();
  }

  active(): boolean {
    return (
      this.#attrs.stripeStatus === "active" ||
      this.#attrs.stripeStatus === "trialing"
    ) && !this.ended();
  }

  cancelled(): boolean {
    return this.#attrs.endsAt != null;
  }

  ended(): boolean {
    const ends = toDate(this.#attrs.endsAt);
    return !!ends && ends.getTime() <= Date.now();
  }

  onTrial(): boolean {
    const trial = toDate(this.#attrs.trialEndsAt);
    return !!trial && trial.getTime() > Date.now();
  }

  onGracePeriod(): boolean {
    const ends = toDate(this.#attrs.endsAt);
    return !!ends && ends.getTime() > Date.now();
  }

  /** Skip proration on the next swap. */
  noProrate(): this {
    this.#noProrate = true;
    return this;
  }

  /** Cancel at period end. */
  async cancel(): Promise<this> {
    const stripe = await Billing.stripe().updateSubscription(this.stripeId, {
      cancel_at_period_end: true,
    });
    const periodEnd = stripe.current_period_end
      ? new Date(stripe.current_period_end * 1000)
      : new Date();
    this.#attrs.endsAt = periodEnd;
    this.#attrs.stripeStatus = stripe.status;
    await this.#persist();
    return this;
  }

  /** Cancel immediately. */
  async cancelNow(): Promise<this> {
    const stripe = await Billing.stripe().cancelSubscription(this.stripeId);
    this.#attrs.endsAt = new Date();
    this.#attrs.stripeStatus = stripe.status;
    await this.#persist();
    return this;
  }

  /** Resume during grace period. */
  async resume(): Promise<this> {
    if (!this.onGracePeriod()) {
      throw new Error("Unable to resume subscription that is not within grace period.");
    }
    const stripe = await Billing.stripe().updateSubscription(this.stripeId, {
      cancel_at_period_end: false,
    });
    this.#attrs.endsAt = null;
    this.#attrs.stripeStatus = stripe.status;
    await this.#persist();
    return this;
  }

  /** Swap to a new price. */
  async swap(price: string): Promise<this> {
    const current = (await this.asStripeSubscription()) as {
      items?: { data: Array<{ id: string }> };
    };
    const itemId = current.items?.data?.[0]?.id;
    if (!itemId) throw new Error("Subscription has no items to swap.");
    const form: Record<string, string | number | boolean> = {
      "items[0][id]": itemId,
      "items[0][price]": price,
    };
    if (this.#noProrate) form.proration_behavior = "none";
    const stripe = await Billing.stripe().updateSubscription(this.stripeId, form);
    this.#attrs.stripePrice = price;
    this.#attrs.stripeStatus = stripe.status;
    this.#noProrate = false;
    await this.#persist();
    return this;
  }

  async #persist(): Promise<void> {
    await Billing.subscriptions().save(ownerId(this.#owner), this.#attrs);
    await persistOwner(this.#owner);
  }

  toAttributes(): SubscriptionAttributes {
    return { ...this.#attrs };
  }
}
