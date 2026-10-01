import { StripeClient } from "./stripe-client.ts";
import { ArraySubscriptionRepository } from "./subscription-repository.ts";
import type {
  BillableOwner,
  BillingConfig,
  FindBillable,
  SubscriptionRepository,
} from "./types.ts";

let config: BillingConfig = {
  currency: "usd",
  path: "stripe",
};
let fetchImpl: typeof fetch = fetch;
let client: StripeClient | undefined;
let repository: SubscriptionRepository = new ArraySubscriptionRepository();
let findBillableFn: FindBillable | null = null;
let calculatesTaxes = false;

function resolveSecret(): string {
  const secret =
    config.secret ??
    process.env.STRIPE_SECRET ??
    process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error(
      "Stripe secret is not configured. Call Billing.configure({ secret }) or set STRIPE_SECRET.",
    );
  }
  return secret;
}

/**
 * Billing facade — configure Stripe + subscription persistence.
 */
export const Billing = {
  configure(next: BillingConfig): void {
    config = { ...config, ...next };
    client = undefined;
  },

  /** Publishable key (frontend). */
  key(): string | undefined {
    return config.key ?? process.env.STRIPE_KEY ?? process.env.STRIPE_PUBLISHABLE_KEY;
  },

  currency(): string {
    return config.currency ?? "usd";
  },

  /** Override fetch (tests). */
  setFetch(next: typeof fetch): void {
    fetchImpl = next;
    client = undefined;
  },

  /** Stripe REST client. */
  stripe(): StripeClient {
    if (!client) client = new StripeClient(resolveSecret(), fetchImpl);
    return client;
  },

  /** Swap Stripe client (tests / fakes). */
  useStripe(next: StripeClient): void {
    client = next;
  },

  subscriptions(): SubscriptionRepository {
    return repository;
  },

  useSubscriptionRepository(next: SubscriptionRepository): void {
    repository = next;
  },

  /** Stripe webhook signing secret. */
  webhookSecret(): string | undefined {
    return (
      config.webhookSecret ??
      process.env.STRIPE_WEBHOOK_SECRET ??
      undefined
    );
  },

  /**
   * Enable Stripe Tax on Checkout / new subscriptions
   * (`automatic_tax[enabled]=true`) — Laravel `Billing::calculateTaxes()`.
   */
  calculateTaxes(value = true): void {
    calculatesTaxes = value;
    config = { ...config, calculateTaxes: value };
  },

  /** Whether Stripe Tax automatic calculation is enabled. */
  calculatesTaxes(): boolean {
    return calculatesTaxes || config.calculateTaxes === true;
  },

  /**
   * Register how to resolve a billable owner from a Stripe customer id
   * (Laravel `Billing::useCustomerModel` / `findBillable` path).
   */
  findBillableUsing(resolver: FindBillable): void {
    findBillableFn = resolver;
  },

  /** Resolve billable by Stripe customer id. */
  async findBillable(stripeId: string): Promise<BillableOwner | null> {
    if (!findBillableFn) return null;
    return findBillableFn(stripeId);
  },

  /** Reset test state. */
  flush(): void {
    config = { currency: "usd", path: "stripe" };
    fetchImpl = fetch;
    client = undefined;
    findBillableFn = null;
    calculatesTaxes = false;
    if (repository instanceof ArraySubscriptionRepository) {
      repository.clear();
    } else {
      repository = new ArraySubscriptionRepository();
    }
  },
};

export function ownerId(owner: BillableOwner): string | number {
  if (owner.id === undefined || owner.id === null) {
    throw new Error("Billable owner must have an id before using Billing.");
  }
  return owner.id;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getStripeId(owner: BillableOwner): string | null {
  return (
    stringField(owner.stripe_id) ??
    stringField(typeof owner.stripeId === "function" ? null : owner.stripeId)
  );
}

export function setStripeId(owner: BillableOwner, id: string): void {
  owner.stripe_id = id;
  // Avoid clobbering mixin methods named stripeId().
  if (typeof owner.stripeId !== "function") owner.stripeId = id;
}

export function getTrialEndsAt(owner: BillableOwner): Date | null {
  const raw = owner.trial_ends_at ?? owner.trialEndsAt ?? null;
  if (!raw || typeof raw === "function") return null;
  return raw instanceof Date ? raw : new Date(String(raw));
}

export function setTrialEndsAt(
  owner: BillableOwner,
  value: Date | string | null,
): void {
  owner.trial_ends_at = value;
  if (typeof owner.trialEndsAt !== "function") owner.trialEndsAt = value;
}

export function setPaymentMethod(
  owner: BillableOwner,
  type: string | null,
  lastFour: string | null,
): void {
  owner.pm_type = type;
  owner.pm_last_four = lastFour;
  if (typeof owner.pmType !== "function") owner.pmType = type;
  if (typeof owner.pmLastFour !== "function") owner.pmLastFour = lastFour;
}

export async function persistOwner(owner: BillableOwner): Promise<void> {
  if (typeof owner.save === "function") await owner.save();
}

export function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  return new Date(String(value));
}
