import {
  Billing,
  getStripeId,
  getTrialEndsAt,
  ownerId,
  persistOwner,
  setPaymentMethod,
  setStripeId,
  setTrialEndsAt,
} from "./billing.ts";
import { SubscriptionBuilder } from "./subscription-builder.ts";
import { Subscription } from "./subscription.ts";
import type {
  BillableOwner,
  StripeCheckoutSession,
  StripeCustomer,
} from "./types.ts";
import {
  Invoice,
  listStripeInvoices,
  retrieveStripeInvoice,
  type InvoiceDownloadOptions,
} from "./invoice.ts";

/**
 * Billable API bound to one owner (User). Prefer `Billable(Model)` mixin for apps.
 */
export class BillableConcern {
  constructor(readonly owner: BillableOwner) {}

  stripeId(): string | null {
    return getStripeId(this.owner);
  }

  hasStripeId(): boolean {
    return !!this.stripeId();
  }

  async createAsStripeCustomer(
    options: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<StripeCustomer> {
    if (this.hasStripeId()) {
      return this.asStripeCustomer();
    }
    const customer = await Billing.stripe().createCustomer({
      email: this.owner.email ?? undefined,
      name: this.owner.name ?? undefined,
      ...options,
    });
    setStripeId(this.owner, customer.id);
    await persistOwner(this.owner);
    return customer;
  }

  async updateStripeCustomer(
    options: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeCustomer> {
    const id = await this.#requireStripeId();
    return Billing.stripe().updateCustomer(id, options);
  }

  async asStripeCustomer(): Promise<StripeCustomer> {
    const id = await this.#requireStripeId();
    return Billing.stripe().retrieveCustomer(id);
  }

  newSubscription(
    type: string,
    prices: string | string[],
  ): SubscriptionBuilder {
    return new SubscriptionBuilder(this.owner, type, prices);
  }

  async subscription(type = "default"): Promise<Subscription | null> {
    const rows = await Billing.subscriptions().allForOwner(ownerId(this.owner));
    const row = rows.find((r) => r.type === type);
    return row ? new Subscription(this.owner, row) : null;
  }

  async subscriptions(): Promise<Subscription[]> {
    const rows = await Billing.subscriptions().allForOwner(ownerId(this.owner));
    return rows.map((r) => new Subscription(this.owner, r));
  }

  async subscribed(type = "default", price?: string): Promise<boolean> {
    const sub = await this.subscription(type);
    if (!sub || !sub.valid()) return false;
    if (price) return sub.stripePrice === price;
    return true;
  }

  onGenericTrial(): boolean {
    const trial = getTrialEndsAt(this.owner);
    return !!trial && trial.getTime() > Date.now();
  }

  async onTrial(type = "default"): Promise<boolean> {
    if (type === "default" && this.onGenericTrial()) return true;
    const sub = await this.subscription(type);
    return !!sub?.onTrial();
  }

  trialEndsAt(type?: string): Date | null {
    if (!type) return getTrialEndsAt(this.owner);
    return null;
  }

  /** Set a generic trial without a subscription. */
  trialEndsAtDate(date: Date | string | null): this {
    setTrialEndsAt(this.owner, date);
    return this;
  }

  hasPaymentMethod(): boolean {
    const type = this.owner.pm_type ?? this.owner.pmType;
    return !!type;
  }

  async updateDefaultPaymentMethod(paymentMethod: string): Promise<this> {
    const customerId = await this.#ensureCustomer();
    await Billing.stripe().request(
      `/v1/payment_methods/${paymentMethod}/attach`,
      { form: { customer: customerId } },
    ).catch(() => undefined);
    await Billing.stripe().updateCustomer(customerId, {
      "invoice_settings[default_payment_method]": paymentMethod,
    });
    const pm = (await Billing.stripe().request(
      `/v1/payment_methods/${paymentMethod}`,
    )) as { type?: string; card?: { last4?: string } };
    setPaymentMethod(
      this.owner,
      pm.type ?? "card",
      pm.card?.last4 ?? null,
    );
    await persistOwner(this.owner);
    return this;
  }

  /** One-off / product Checkout session. */
  async checkout(
    priceId: string,
    sessionOptions: {
      success_url?: string;
      cancel_url?: string;
      quantity?: number;
      mode?: "payment" | "subscription";
      [key: string]: unknown;
    } = {},
  ): Promise<StripeCheckoutSession> {
    const customerId = await this.#ensureCustomer();
    const mode = sessionOptions.mode ?? "payment";
    const form: Record<string, string | number | boolean> = {
      mode,
      customer: customerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": sessionOptions.quantity ?? 1,
      success_url:
        String(sessionOptions.success_url ?? "http://localhost/checkout/success"),
      cancel_url:
        String(sessionOptions.cancel_url ?? "http://localhost/checkout/cancel"),
    };
    if (Billing.calculatesTaxes()) {
      form["automatic_tax[enabled]"] = true;
    }
    return Billing.stripe().createCheckoutSession(form);
  }

  async redirectToBillingPortal(returnUrl: string): Promise<string> {
    const customerId = await this.#ensureCustomer();
    const session = await Billing.stripe().createBillingPortalSession({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }


  /** List the customer's invoices. */
  async invoices(params: { limit?: number } = {}): Promise<Invoice[]> {
    const id = await this.#requireStripeId();
    return listStripeInvoices(id, params);
  }

  /** Find an invoice by id. */
  async findInvoice(invoiceId: string): Promise<Invoice | null> {
    try {
      const invoice = await retrieveStripeInvoice(invoiceId);
      const customer = invoice.raw.customer;
      const mine = await this.#requireStripeId();
      if (customer && customer !== mine) return null;
      return invoice;
    } catch {
      return null;
    }
  }

  /**
   * Download an invoice by id.
   * Returns Stripe-hosted PDF URL + filename (minimal Billing PDF path).
   */
  async downloadInvoice(
    invoiceId: string,
    data: InvoiceDownloadOptions = {},
    filename?: string,
  ): Promise<{ url: string; filename: string; invoice: Invoice }> {
    const invoice = await this.findInvoice(invoiceId);
    if (!invoice) throw new Error(`Invoice [${invoiceId}] not found for this customer.`);
    return invoice.download(data, filename);
  }

  /**
   * Create a tax id for the customer,
   * e.g. `createTaxId('eu_vat', 'DE123')`.
   */
  async createTaxId(type: string, value: string): Promise<Record<string, unknown>> {
    const customerId = await this.#ensureCustomer();
    return Billing.stripe().request(`/v1/customers/${customerId}/tax_ids`, {
      form: { type, value },
    });
  }

  /** List the customer's tax ids. */
  async taxIds(): Promise<Record<string, unknown>[]> {
    const customerId = await this.#requireStripeId();
    const res = await Billing.stripe().request<{ data: Record<string, unknown>[] }>(
      `/v1/customers/${customerId}/tax_ids`,
    );
    return res.data ?? [];
  }

  async #ensureCustomer(): Promise<string> {
    if (!this.hasStripeId()) {
      await this.createAsStripeCustomer();
    }
    return this.stripeId()!;
  }

  async #requireStripeId(): Promise<string> {
    const id = this.stripeId();
    if (!id) throw new Error("Billable owner is not a Stripe customer yet.");
    return id;
  }
}

/** Bind Billing methods to a plain owner object. */
export function billable(owner: BillableOwner): BillableConcern {
  return new BillableConcern(owner);
}

/** Mixin base — any constructable class (e.g. ORM `Model`). */
type Constructor = new (...args: any[]) => object;

/**
 * Mixin — `class User extends Billable(Model) { ... }`.
 */
export function Billable<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    #concern(): BillableConcern {
      return new BillableConcern(this as unknown as BillableOwner);
    }

    stripeId(): string | null {
      return this.#concern().stripeId();
    }

    hasStripeId(): boolean {
      return this.#concern().hasStripeId();
    }

    createAsStripeCustomer(
      options: Record<string, string | number | boolean | null | undefined> = {},
    ) {
      return this.#concern().createAsStripeCustomer(options);
    }

    updateStripeCustomer(
      options: Record<string, string | number | boolean | null | undefined>,
    ) {
      return this.#concern().updateStripeCustomer(options);
    }

    asStripeCustomer() {
      return this.#concern().asStripeCustomer();
    }

    newSubscription(type: string, prices: string | string[]) {
      return this.#concern().newSubscription(type, prices);
    }

    subscription(type = "default") {
      return this.#concern().subscription(type);
    }

    subscriptions() {
      return this.#concern().subscriptions();
    }

    subscribed(type = "default", price?: string) {
      return this.#concern().subscribed(type, price);
    }

    onGenericTrial(): boolean {
      return this.#concern().onGenericTrial();
    }

    onTrial(type = "default") {
      return this.#concern().onTrial(type);
    }

    trialEndsAt(type?: string): Date | null {
      return this.#concern().trialEndsAt(type);
    }

    hasPaymentMethod(): boolean {
      return this.#concern().hasPaymentMethod();
    }

    updateDefaultPaymentMethod(paymentMethod: string) {
      return this.#concern().updateDefaultPaymentMethod(paymentMethod);
    }

    checkout(
      priceId: string,
      sessionOptions: {
        success_url?: string;
        cancel_url?: string;
        quantity?: number;
        mode?: "payment" | "subscription";
        [key: string]: unknown;
      } = {},
    ) {
      return this.#concern().checkout(priceId, sessionOptions);
    }

    redirectToBillingPortal(returnUrl: string) {
      return this.#concern().redirectToBillingPortal(returnUrl);
    }

    invoices(params: { limit?: number } = {}) {
      return this.#concern().invoices(params);
    }

    findInvoice(invoiceId: string) {
      return this.#concern().findInvoice(invoiceId);
    }

    downloadInvoice(
      invoiceId: string,
      data: InvoiceDownloadOptions = {},
      filename?: string,
    ) {
      return this.#concern().downloadInvoice(invoiceId, data, filename);
    }

    createTaxId(type: string, value: string) {
      return this.#concern().createTaxId(type, value);
    }

    taxIds() {
      return this.#concern().taxIds();
    }
  };
}
