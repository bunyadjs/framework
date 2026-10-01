import type {
  StripeBillingPortalSession,
  StripeCheckoutSession,
  StripeCustomer,
  StripeSubscription,
} from "./types.ts";

export type StripeRequestOptions = {
  method?: string;
  form?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Thin Stripe REST client (API version pinned). Injectable fetch for tests.
 */
export class StripeClient {
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase = "https://api.stripe.com",
  ) {}

  async request<T>(
    path: string,
    options: StripeRequestOptions = {},
  ): Promise<T> {
    const method = options.method ?? (options.form ? "POST" : "GET");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secret}`,
      "Stripe-Version": "2024-11-20.acacia",
    };
    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = encodeForm(options.form);
    }
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers,
      body,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(
        json.error?.message ?? `Stripe API error ${res.status} on ${path}`,
      );
    }
    return json;
  }

  createCustomer(
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeCustomer> {
    return this.request("/v1/customers", { form });
  }

  retrieveCustomer(id: string): Promise<StripeCustomer> {
    return this.request(`/v1/customers/${id}`);
  }

  updateCustomer(
    id: string,
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeCustomer> {
    return this.request(`/v1/customers/${id}`, { form });
  }

  createSubscription(
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeSubscription> {
    return this.request("/v1/subscriptions", { form });
  }

  updateSubscription(
    id: string,
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeSubscription> {
    return this.request(`/v1/subscriptions/${id}`, { form });
  }

  cancelSubscription(
    id: string,
    form: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<StripeSubscription> {
    return this.request(`/v1/subscriptions/${id}`, {
      method: "DELETE",
      form,
    });
  }

  createCheckoutSession(
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeCheckoutSession> {
    return this.request("/v1/checkout/sessions", { form });
  }

  createBillingPortalSession(
    form: Record<string, string | number | boolean | null | undefined>,
  ): Promise<StripeBillingPortalSession> {
    return this.request("/v1/billing_portal/sessions", { form });
  }
}

function encodeForm(
  form: Record<string, string | number | boolean | null | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  return params.toString();
}
