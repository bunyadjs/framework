/** Persisted subscription row (Billing `subscriptions` table shape). */
export type SubscriptionAttributes = {
  id?: string | number;
  userId?: string | number;
  type: string;
  stripeId: string;
  stripeStatus: string;
  stripePrice: string | null;
  quantity: number;
  trialEndsAt: Date | string | null;
  endsAt: Date | string | null;
};

/** Billable owner — typically a User model with Billing columns. */
export type BillableOwner = {
  id?: string | number;
  email?: string | null;
  name?: string | null;
  stripe_id?: string | null;
  stripeId?: string | null | (() => string | null);
  pm_type?: string | null;
  pmType?: string | null;
  pm_last_four?: string | null;
  pmLastFour?: string | null;
  trial_ends_at?: Date | string | null;
  trialEndsAt?: Date | string | null | ((type?: string) => Date | null);
  save?: () => Promise<unknown>;
};

export type StripeCustomer = {
  id: string;
  email?: string | null;
  name?: string | null;
  invoice_settings?: { default_payment_method?: string | null };
  [key: string]: unknown;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  current_period_end?: number;
  trial_end?: number | null;
  items?: {
    data: Array<{
      id: string;
      price: { id: string };
      quantity?: number;
    }>;
  };
  [key: string]: unknown;
};

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  [key: string]: unknown;
};

export type StripeBillingPortalSession = {
  id: string;
  url: string;
  [key: string]: unknown;
};

export type BillingConfig = {
  key?: string;
  secret?: string;
  /** Stripe webhook signing secret (`whsec_…` / STRIPE_WEBHOOK_SECRET). */
  webhookSecret?: string;
  currency?: string;
  path?: string;
  /** When true, Checkout/subscriptions send `automatic_tax[enabled]=true`. */
  calculateTaxes?: boolean;
};

export type SubscriptionRepository = {
  allForOwner(ownerId: string | number): Promise<SubscriptionAttributes[]>;
  save(ownerId: string | number, row: SubscriptionAttributes): Promise<SubscriptionAttributes>;
  forget(ownerId: string | number, type: string): Promise<void>;
  /** Optional — webhooks use this to sync by Stripe subscription id. */
  findByStripeId?(stripeId: string): Promise<SubscriptionAttributes | null>;
};

export type FindBillable = (
  stripeId: string,
) => BillableOwner | null | Promise<BillableOwner | null>;
