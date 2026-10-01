import { afterEach, expect, test } from "bun:test";
import {
  Billable,
  billable,
  Billing,
  Checkout,
} from "./index.ts";

afterEach(() => {
  Billing.flush();
});

type FakeOwner = {
  id: number;
  email: string;
  name: string;
  stripe_id?: string | null;
  pm_type?: string | null;
  pm_last_four?: string | null;
  trial_ends_at?: Date | null;
  saves: number;
  save(): Promise<void>;
};

function makeOwner(overrides: Partial<FakeOwner> = {}): FakeOwner {
  const owner: FakeOwner = {
    id: 1,
    email: "ada@example.com",
    name: "Ada",
    stripe_id: null,
    saves: 0,
    async save() {
      owner.saves += 1;
    },
    ...overrides,
  };
  return owner;
}

function mockStripe(routes: Record<string, (req: Request) => unknown | Promise<unknown>>) {
  Billing.configure({ secret: "sk_test_fake" });
  Billing.setFetch(async (input, init) => {
    const url = String(input);
    const path = url.replace("https://api.stripe.com", "");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path.split("?")[0]}`;
    const handler =
      routes[key] ??
      routes[path.split("?")[0]!] ??
      (() => {
        throw new Error(`Unexpected Stripe call: ${key}`);
      });
    const body = await handler(
      new Request(url, init as RequestInit),
    );
    return Response.json(body);
  });
}

test("createAsStripeCustomer stores stripe_id", async () => {
  mockStripe({
    "POST /v1/customers": () => ({
      id: "cus_1",
      email: "ada@example.com",
      name: "Ada",
    }),
  });
  const owner = makeOwner();
  const customer = await billable(owner).createAsStripeCustomer();
  expect(customer.id).toBe("cus_1");
  expect(owner.stripe_id).toBe("cus_1");
  expect(owner.saves).toBe(1);
  expect(billable(owner).hasStripeId()).toBe(true);
});

test("newSubscription.create persists and subscribed is true", async () => {
  mockStripe({
    "POST /v1/customers": () => ({ id: "cus_2" }),
    "POST /v1/payment_methods/pm_card/attach": () => ({ id: "pm_card" }),
    "POST /v1/customers/cus_2": () => ({ id: "cus_2" }),
    "POST /v1/subscriptions": () => ({
      id: "sub_1",
      status: "active",
      customer: "cus_2",
      items: { data: [{ id: "si_1", price: { id: "price_pro" }, quantity: 1 }] },
    }),
  });
  const owner = makeOwner();
  const sub = await billable(owner)
    .newSubscription("default", "price_pro")
    .create("pm_card");
  expect(sub.stripeId).toBe("sub_1");
  expect(sub.active()).toBe(true);
  expect(await billable(owner).subscribed("default")).toBe(true);
  expect(await billable(owner).subscribed("default", "price_pro")).toBe(true);
});

test("subscription cancel and resume during grace period", async () => {
  const periodEnd = Math.floor(Date.now() / 1000) + 86_400;
  mockStripe({
    "POST /v1/subscriptions/sub_grace": (req) => {
      // update
      return {
        id: "sub_grace",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: periodEnd,
        items: { data: [{ id: "si_1", price: { id: "price_pro" } }] },
      };
    },
  });

  const owner = makeOwner({ stripe_id: "cus_3" });
  await Billing.subscriptions().save(owner.id, {
    type: "default",
    stripeId: "sub_grace",
    stripeStatus: "active",
    stripePrice: "price_pro",
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
  });

  const sub = (await billable(owner).subscription("default"))!;
  await sub.cancel();
  expect(sub.cancelled()).toBe(true);
  expect(sub.onGracePeriod()).toBe(true);
  expect(await billable(owner).subscribed()).toBe(true);

  Billing.setFetch(async (input, init) => {
    const url = String(input);
    if (url.includes("/v1/subscriptions/sub_grace") && init?.method !== "DELETE") {
      return Response.json({
        id: "sub_grace",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ id: "si_1", price: { id: "price_pro" } }] },
      });
    }
    throw new Error(`Unexpected ${url}`);
  });

  await sub.resume();
  expect(sub.cancelled()).toBe(false);
  expect(sub.onGracePeriod()).toBe(false);
});

test("subscription swap changes price", async () => {
  mockStripe({
    "GET /v1/subscriptions/sub_swap": () => ({
      id: "sub_swap",
      status: "active",
      items: { data: [{ id: "si_1", price: { id: "price_old" } }] },
    }),
    "POST /v1/subscriptions/sub_swap": () => ({
      id: "sub_swap",
      status: "active",
      items: { data: [{ id: "si_1", price: { id: "price_new" } }] },
    }),
  });
  const owner = makeOwner({ stripe_id: "cus_4" });
  await Billing.subscriptions().save(owner.id, {
    type: "default",
    stripeId: "sub_swap",
    stripeStatus: "active",
    stripePrice: "price_old",
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
  });
  const sub = (await billable(owner).subscription())!;
  await sub.noProrate().swap("price_new");
  expect(sub.stripePrice).toBe("price_new");
});

test("Checkout.customer creates session", async () => {
  mockStripe({
    "POST /v1/customers": () => ({ id: "cus_chk" }),
    "POST /v1/checkout/sessions": () => ({
      id: "cs_1",
      url: "https://checkout.stripe.com/c/pay/cs_1",
    }),
  });
  const owner = makeOwner();
  const session = await Checkout.customer(owner)
    .lineItem("price_one")
    .create({
      success_url: "https://app.test/ok",
      cancel_url: "https://app.test/cancel",
    });
  expect(session.id).toBe("cs_1");
  expect(session.url).toContain("checkout.stripe.com");
  expect(owner.stripe_id).toBe("cus_chk");
});

test("newSubscription.checkout and billing portal", async () => {
  mockStripe({
    "POST /v1/customers": () => ({ id: "cus_portal" }),
    "POST /v1/checkout/sessions": () => ({
      id: "cs_sub",
      url: "https://checkout.stripe.com/c/pay/cs_sub",
    }),
    "POST /v1/billing_portal/sessions": () => ({
      id: "bps_1",
      url: "https://billing.stripe.com/session/1",
    }),
  });
  const owner = makeOwner();
  const b = billable(owner);
  const checkout = await b
    .newSubscription("default", "price_pro")
    .trialDays(7)
    .checkout({ success_url: "https://app.test/ok" });
  expect(checkout.id).toBe("cs_sub");
  const portal = await b.redirectToBillingPortal("https://app.test/billing");
  expect(portal).toContain("billing.stripe.com");
});

test("Billable mixin exposes methods on class", async () => {
  mockStripe({
    "POST /v1/customers": () => ({ id: "cus_mix" }),
  });

  class User extends Billable(
    class {
      id = 9;
      email = "mix@example.com";
      name = "Mix";
      stripe_id: string | null = null;
      async save() {}
    },
  ) {}

  const user = new User();
  await user.createAsStripeCustomer();
  expect(user.stripeId()).toBe("cus_mix");
  expect(user.hasStripeId()).toBe(true);
});

test("onGenericTrial from trial_ends_at", () => {
  const owner = makeOwner({
    trial_ends_at: new Date(Date.now() + 86_400_000),
  });
  expect(billable(owner).onGenericTrial()).toBe(true);
});

test("verifyStripeSignature accepts valid HMAC", async () => {
  const { verifyStripeSignature } = await import("./webhook.ts");
  const secret = "whsec_test";
  const payload = '{"id":"evt_1","type":"invoice.payment_succeeded"}';
  const t = Math.floor(Date.now() / 1000);
  const { createHmac } = await import("node:crypto");
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  expect(verifyStripeSignature(payload, `t=${t},v1=${v1}`, secret)).toBe(true);
  expect(verifyStripeSignature(payload, `t=${t},v1=deadbeef`, secret)).toBe(false);
});

test("webhook customer.subscription.updated syncs repository", async () => {
  const { WebhookController } = await import("./webhook.ts");
  const owner = makeOwner({ id: 42, stripe_id: "cus_wh" });
  Billing.findBillableUsing(async (id) => (id === "cus_wh" ? owner : null));

  await Billing.subscriptions().save(owner.id, {
    type: "default",
    stripeId: "sub_wh",
    stripeStatus: "active",
    stripePrice: "price_old",
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
  });

  const periodEnd = Math.floor(Date.now() / 1000) + 86_400;
  const controller = new WebhookController();
  const result = await controller.handleWebhook({
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_wh",
        status: "active",
        customer: "cus_wh",
        cancel_at_period_end: true,
        current_period_end: periodEnd,
        items: {
          data: [{ id: "si_1", price: { id: "price_new" }, quantity: 2 }],
        },
      },
    },
  });
  expect(result.status).toBe(200);
  const row = await Billing.subscriptions().findByStripeId!("sub_wh");
  expect(row?.stripePrice).toBe("price_new");
  expect(row?.quantity).toBe(2);
  expect(row?.endsAt).toBeTruthy();
});

test("webhook customer.subscription.created persists new row", async () => {
  const { WebhookController } = await import("./webhook.ts");
  const owner = makeOwner({ id: 7, stripe_id: "cus_new" });
  Billing.findBillableUsing(async (id) => (id === "cus_new" ? owner : null));
  const controller = new WebhookController();
  await controller.handleWebhook({
    type: "customer.subscription.created",
    data: {
      object: {
        id: "sub_created",
        status: "trialing",
        customer: "cus_new",
        trial_end: Math.floor(Date.now() / 1000) + 86400,
        metadata: { type: "default" },
        items: {
          data: [{ id: "si_1", price: { id: "price_pro" }, quantity: 1 }],
        },
      },
    },
  });
  const row = await Billing.subscriptions().findByStripeId!("sub_created");
  expect(row?.stripeStatus).toBe("trialing");
  expect(row?.stripePrice).toBe("price_pro");
  expect(await billable(owner).subscribed()).toBe(true);
});

test("webhook rejects bad signature when secret configured", async () => {
  const { WebhookController } = await import("./webhook.ts");
  Billing.configure({ secret: "sk_test", webhookSecret: "whsec_live" });
  const res = await new WebhookController().handleRequest(
    new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=nope" },
      body: "{}",
    }),
  );
  expect(res.status).toBe(400);
});

test("downloadInvoice returns Stripe PDF URL", async () => {
  mockStripe({
    "GET /v1/invoices/in_1": () => ({
      id: "in_1",
      number: "INV-1",
      customer: "cus_inv",
      invoice_pdf: "https://files.stripe.com/invoices/in_1/pdf",
      hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
    }),
  });
  const owner = makeOwner({ stripe_id: "cus_inv" });
  const dl = await billable(owner).downloadInvoice("in_1", { vendor: "Acme" });
  expect(dl.url).toContain("files.stripe.com");
  expect(dl.filename).toBe("INV-1.pdf");
});

test("invoices lists customer invoices", async () => {
  mockStripe({
    "GET /v1/invoices": () => ({
      data: [
        {
          id: "in_a",
          number: "A-1",
          customer: "cus_list",
          invoice_pdf: "https://files.stripe.com/a.pdf",
        },
      ],
    }),
  });
  // mockStripe keys on full path without query — adjust fetch
  Billing.setFetch(async (input) => {
    const url = String(input);
    if (url.includes("/v1/invoices")) {
      return Response.json({
        data: [
          {
            id: "in_a",
            number: "A-1",
            customer: "cus_list",
            invoice_pdf: "https://files.stripe.com/a.pdf",
          },
        ],
      });
    }
    throw new Error(url);
  });
  Billing.configure({ secret: "sk_test_fake" });
  const owner = makeOwner({ stripe_id: "cus_list" });
  const list = await billable(owner).invoices();
  expect(list).toHaveLength(1);
  expect(list[0]!.id()).toBe("in_a");
});

test("calculateTaxes adds automatic_tax on checkout create", async () => {
  let sawTax = false;
  Billing.configure({ secret: "sk_test_fake" });
  Billing.calculateTaxes();
  Billing.setFetch(async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    if (url.includes("/v1/customers") && (init?.method ?? "GET") === "POST") {
      return Response.json({ id: "cus_tax" });
    }
    if (url.includes("/v1/checkout/sessions")) {
      sawTax = body.includes("automatic_tax%5Benabled%5D=true") || body.includes("automatic_tax[enabled]=true");
      return Response.json({ id: "cs_tax", url: "https://checkout.stripe.com/tax" });
    }
    throw new Error(url);
  });
  const owner = makeOwner();
  await Checkout.customer(owner).lineItem("price_tax").create({
    success_url: "https://app.test/ok",
  });
  expect(sawTax).toBe(true);
  expect(Billing.calculatesTaxes()).toBe(true);
});

test("createTaxId posts to Stripe tax_ids", async () => {
  mockStripe({
    "POST /v1/customers/cus_vat/tax_ids": () => ({
      id: "txi_1",
      type: "eu_vat",
      value: "DE123",
    }),
  });
  const owner = makeOwner({ stripe_id: "cus_vat" });
  const tax = await billable(owner).createTaxId("eu_vat", "DE123");
  expect(tax.id).toBe("txi_1");
});

test("webhook fails closed in production without secret", async () => {
  const { WebhookController } = await import("./webhook.ts");
  Billing.configure({ secret: "sk_test" }); // no webhookSecret
  const prevEnv = process.env.NODE_ENV;
  const prevApp = process.env.APP_ENV;
  const prevWh = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.APP_ENV;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const res = await new WebhookController().handleRequest(
      new Request("http://localhost/stripe/webhook", {
        method: "POST",
        body: JSON.stringify({
          type: "customer.subscription.updated",
          data: { object: { id: "sub_x" } },
        }),
      }),
    );
    expect(res.status).toBe(500);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
    if (prevWh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevWh;
  }
});

test("webhook rejects forged event with wrong signature when secret required", async () => {
  const { WebhookController, verifyStripeSignature } = await import(
    "./webhook.ts"
  );
  Billing.configure({ secret: "sk_test", webhookSecret: "whsec_required" });
  const payload = JSON.stringify({
    type: "customer.subscription.updated",
    data: { object: { id: "sub_forged", customer: "cus_x", status: "active" } },
  });
  const res = await new WebhookController().handleRequest(
    new Request("http://localhost/stripe/webhook", {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=forged" },
      body: payload,
    }),
  );
  expect(res.status).toBe(400);
  expect(verifyStripeSignature(payload, "t=1,v1=forged", "whsec_required")).toBe(
    false,
  );
});

test("webhook non-production allows unsigned when secret unset (local DX only)", async () => {
  const { WebhookController } = await import("./webhook.ts");
  Billing.configure({ secret: "sk_test" }); // no webhookSecret
  const prevEnv = process.env.NODE_ENV;
  const prevApp = process.env.APP_ENV;
  const prevWh = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.NODE_ENV = "development";
  delete process.env.APP_ENV;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const res = await new WebhookController().handleRequest(
      new Request("http://localhost/stripe/webhook", {
        method: "POST",
        body: JSON.stringify({
          type: "invoice.payment_succeeded",
          data: { object: { id: "in_dev" } },
        }),
      }),
    );
    // Intentional local-only carve-out; production remains fail-closed (SEC-005).
    expect(res.status).toBe(200);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
    if (prevWh === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevWh;
  }
});
