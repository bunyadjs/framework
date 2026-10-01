import { afterEach, expect, test } from "bun:test";
import { Billing } from "@bunyad/billing";
import { Mail } from "@bunyad/mail";
import { Queue } from "@bunyad/queue";
import SendWelcomeEmailJob from "@/Jobs/SendWelcomeEmailJob.ts";
import User from "@/Models/User.ts";
import { browser, client } from "./client.ts";

afterEach(() => {
  Billing.flush();
});

/** Answer Stripe API calls from `routes` ("POST /v1/customers" → body). */
function mockStripe(routes: Record<string, () => unknown>) {
  Billing.configure({ secret: "sk_test_fake" });
  Billing.setFetch(async (input, init) => {
    const path = String(input).replace("https://api.stripe.com", "").split("?")[0]!;
    const key = `${(init?.method ?? "GET").toUpperCase()} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected Stripe call: ${key}`);
    return Response.json(handler());
  });
}

test("registering queues the welcome email", async () => {
  const app = await client();
  Mail.fake();
  const queued = await Queue.size();

  (await app.post("/register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  }, browser)).assertRedirect("/dashboard");
  expect(await Queue.size()).toBe(queued + 1);

  await new SendWelcomeEmailJob("ada@example.com").handle();
  Mail.assertSent((mail) => String(mail.to).includes("ada@example.com"));
  Mail.restore();
});

test("only the first account can open the admin area", async () => {
  const app = await client();
  const admin = await User.factory().create();
  const member = await User.factory().create();

  await app.actingAs(admin);
  (await app.get("/admin", browser)).assertOk();
  await (await app.get("/dashboard", browser)).assertSee(">\n              Admin");

  await app.actingAs(member);
  (await app.get("/admin", browser)).assertForbidden();
});

test("upgrading starts Stripe Checkout", async () => {
  const app = await client();
  mockStripe({
    "POST /v1/customers": () => ({ id: "cus_saas_1" }),
    "POST /v1/checkout/sessions": () => ({ id: "cs_saas_1", url: "https://checkout.stripe.com/c/pay/cs_saas_1" }),
  });
  const user = await User.factory().create();

  await app.actingAs(user);
  (await app.post("/billing/upgrade", undefined, browser)).assertRedirectContains("checkout.stripe.com");
  expect((await User.find(user.id))!.stripe_id).toBe("cus_saas_1");
});

test("the billing page shows an active subscription", async () => {
  const app = await client();
  const user = await User.factory().create({ stripe_id: "cus_sub_1" });
  await Billing.subscriptions().save(user.id!, {
    type: "default",
    stripeId: "sub_1",
    stripeStatus: "active",
    stripePrice: "price_pro",
    quantity: 1,
    trialEndsAt: null,
    endsAt: null,
  });

  await app.actingAs(user);
  const page = await app.get("/billing", browser);
  page.assertOk();
  await page.assertSee("Current plan:");
  await page.assertSee("pro");
  await page.assertSee("Open billing portal");
});
