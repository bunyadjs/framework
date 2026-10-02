# @bunyad/billing

Stripe billing for Bunyad: customers, subscriptions, Checkout and billing-portal sessions, invoices and signature-verified webhooks, over plain `fetch` (no Stripe SDK).

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/billing@beta
# or: npm install @bunyad/billing@beta
```

## Usage

```ts
import { Billing, billable } from "@bunyad/billing";

Billing.configure({ secret: "sk_test_fake" });
// Fake Stripe so this runs offline. In production leave the default fetch in place.
Billing.setFetch(async (input, init) => {
  const route = `${init?.method ?? "GET"} ${new URL(String(input)).pathname}`;
  if (route === "POST /v1/customers") return Response.json({ id: "cus_1" });
  if (route === "POST /v1/subscriptions") {
    return Response.json({
      id: "sub_1", status: "active", customer: "cus_1",
      items: { data: [{ id: "si_1", price: { id: "price_pro" }, quantity: 1 }] },
    });
  }
  throw new Error(`Unexpected Stripe call: ${route}`);
});

// Any object with an id and a save() works as a billable owner (usually a User model).
const owner = {
  id: 1, email: "ada@example.com", name: "Ada", stripe_id: null as string | null,
  async save() {},
};

await billable(owner).createAsStripeCustomer();
console.log(owner.stripe_id); // cus_1

const sub = await billable(owner).newSubscription("default", "price_pro").create();
console.log(sub.stripeId, sub.active()); // sub_1 true
console.log(await billable(owner).subscribed("default", "price_pro")); // true
```

## Notes

- Runs on Bun only (1.4 or newer). No peer dependencies; Stripe is called through `fetch`.
- `Billing.configure({ key, secret, webhookSecret, currency, calculateTaxes })` sets credentials. Without a `webhookSecret`, unsigned webhooks are accepted outside production only.
- Subscriptions are stored through a `SubscriptionRepository`; the default is the in-memory `ArraySubscriptionRepository`, so supply your own with `Billing.useSubscriptionRepository()` for persistence.
- Webhooks: pass the incoming `Request` to `handleStripeWebhook(request)`, and map Stripe customer ids to owners with `Billing.findBillableUsing()`.
- Also includes `Checkout`, `Subscription` (cancel, resume, swap) and `Invoice` helpers.

## License

MIT
