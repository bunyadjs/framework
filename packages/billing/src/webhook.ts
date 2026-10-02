import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Billing,
  ownerId,
  persistOwner,
  setPaymentMethod,
  setTrialEndsAt,
} from "./billing.ts";
import type { BillableOwner, StripeSubscription, SubscriptionAttributes } from "./types.ts";

export type StripeWebhookEvent = {
  id?: string;
  type: string;
  data: { object: Record<string, unknown> };
  [key: string]: unknown;
};

export type WebhookHandlerResult = {
  status: number;
  body: string;
};

/**
 * Verify Stripe-Signature header (t=…,v1=…).
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((piece) => {
      const [k, ...rest] = piece.split("=");
      return [k?.trim() ?? "", rest.join("=").trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function studlyFromStripeType(type: string): string {
  return type
    .split(/[._]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function success(): WebhookHandlerResult {
  return { status: 200, body: "Webhook Handled" };
}

function missing(): WebhookHandlerResult {
  return { status: 200, body: "" };
}

function firstItem(data: StripeSubscription) {
  return data.items?.data?.[0];
}

function subscriptionTypeFromPayload(
  data: Record<string, unknown>,
  fallback = "default",
): string {
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const type = meta.type ?? meta.name;
  return typeof type === "string" && type.length > 0 ? type : fallback;
}

function attrsFromStripe(
  data: StripeSubscription,
  type: string,
  existing?: SubscriptionAttributes,
): SubscriptionAttributes {
  const item = firstItem(data);
  const isSingle = (data.items?.data?.length ?? 0) === 1;
  let endsAt: Date | string | null = existing?.endsAt ?? null;
  if (data.cancel_at_period_end) {
    const trial = data.trial_end ? new Date(data.trial_end * 1000) : null;
    const periodEnd = data.current_period_end
      ? new Date(data.current_period_end * 1000)
      : null;
    endsAt = trial && trial.getTime() > Date.now() ? trial : periodEnd;
  } else if (
    typeof data.cancel_at === "number" ||
    typeof data.canceled_at === "number"
  ) {
    const ts = (data.cancel_at ?? data.canceled_at) as number;
    endsAt = new Date(ts * 1000);
  } else if (!data.cancel_at_period_end) {
    endsAt = null;
  }
  return {
    id: existing?.id,
    userId: existing?.userId,
    type: existing?.type ?? type,
    stripeId: data.id,
    stripeStatus: data.status,
    stripePrice: isSingle ? item?.price?.id ?? null : null,
    quantity: isSingle ? item?.quantity ?? 1 : existing?.quantity ?? 1,
    trialEndsAt: data.trial_end ? new Date(data.trial_end * 1000) : null,
    endsAt,
  };
}

/**
 * Billing-shaped webhook controller.
 * Wire: `router.post('/stripe/webhook', (req) => new WebhookController().handleRequest(req))`
 */
export class WebhookController {
  /**
   * Handle a Fetch API Request (verifies signature when webhook secret is set).
   */
  async handleRequest(request: Request): Promise<Response> {
    const raw = await request.text();
    const secret =
      Billing.webhookSecret() ??
      process.env.STRIPE_WEBHOOK_SECRET ??
      undefined;
    const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
    const production = env === "production";

    // Fail closed in production when the signing secret is missing (BUN-SEC-005).
    if (!secret) {
      if (production) {
        return new Response("Webhook secret not configured", { status: 500 });
      }
      // Non-production: allow unsigned events for local testing only.
    } else {
      const ok = verifyStripeSignature(
        raw,
        request.headers.get("Stripe-Signature"),
        secret,
      );
      if (!ok) {
        return new Response("Invalid signature", { status: 400 });
      }
    }
    let payload: StripeWebhookEvent;
    try {
      payload = JSON.parse(raw) as StripeWebhookEvent;
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }
    const result = await this.handleWebhook(payload);
    return new Response(result.body, { status: result.status });
  }

  /**
   * Dispatch by Stripe event type → `handleCustomerSubscriptionUpdated` etc.
   */
  async handleWebhook(payload: StripeWebhookEvent): Promise<WebhookHandlerResult> {
    const method = `handle${studlyFromStripeType(payload.type)}` as keyof this;
    const fn = this[method];
    if (typeof fn === "function") {
      return await (fn as (p: StripeWebhookEvent) => Promise<WebhookHandlerResult>).call(
        this,
        payload,
      );
    }
    return this.missingMethod(payload);
  }

  protected successMethod(): WebhookHandlerResult {
    return success();
  }

  protected missingMethod(_payload?: StripeWebhookEvent): WebhookHandlerResult {
    return missing();
  }

  protected async getUserByStripeId(
    stripeId: string | null | undefined,
  ): Promise<BillableOwner | null> {
    if (!stripeId) return null;
    return Billing.findBillable(stripeId);
  }

  protected newSubscriptionType(_payload: StripeWebhookEvent): string {
    return "default";
  }

  async handleCustomerSubscriptionCreated(
    payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const data = payload.data.object as unknown as StripeSubscription;
    const user = await this.getUserByStripeId(data.customer);
    if (!user) return this.successMethod();

    const existing = await Billing.subscriptions().findByStripeId?.(data.id);
    if (!existing) {
      const type = subscriptionTypeFromPayload(
        data as unknown as Record<string, unknown>,
        this.newSubscriptionType(payload),
      );
      const row = attrsFromStripe(data, type);
      row.userId = ownerId(user);
      await Billing.subscriptions().save(ownerId(user), row);
    }

    if (user.trial_ends_at != null || user.trialEndsAt != null) {
      setTrialEndsAt(user, null);
      await persistOwner(user);
    }
    return this.successMethod();
  }

  async handleCustomerSubscriptionUpdated(
    payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const data = payload.data.object as unknown as StripeSubscription;
    const user = await this.getUserByStripeId(data.customer);
    if (!user) return this.successMethod();

    if (data.status === "incomplete_expired") {
      const found = await Billing.subscriptions().findByStripeId?.(data.id);
      if (found) {
        await Billing.subscriptions().forget(ownerId(user), found.type);
      }
      return this.successMethod();
    }

    const existing = await Billing.subscriptions().findByStripeId?.(data.id);
    const type =
      existing?.type ??
      subscriptionTypeFromPayload(
        data as unknown as Record<string, unknown>,
        this.newSubscriptionType(payload),
      );
    const row = attrsFromStripe(data, type, existing ?? undefined);
    row.userId = ownerId(user);
    await Billing.subscriptions().save(ownerId(user), row);
    return this.successMethod();
  }

  async handleCustomerSubscriptionDeleted(
    payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const data = payload.data.object as unknown as StripeSubscription;
    const user = await this.getUserByStripeId(data.customer);
    if (!user) return this.successMethod();
    const rows = await Billing.subscriptions().allForOwner(ownerId(user));
    for (const row of rows) {
      if (row.stripeId !== data.id) continue;
      row.endsAt = new Date();
      row.trialEndsAt = null;
      row.stripeStatus = data.status ?? "canceled";
      await Billing.subscriptions().save(ownerId(user), row);
    }
    return this.successMethod();
  }

  async handleCustomerDeleted(
    payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const data = payload.data.object as { id?: string };
    const user = await this.getUserByStripeId(data.id);
    if (!user) return this.successMethod();
    const rows = await Billing.subscriptions().allForOwner(ownerId(user));
    for (const row of rows) {
      row.endsAt = new Date();
      row.trialEndsAt = null;
      row.stripeStatus = "canceled";
      await Billing.subscriptions().save(ownerId(user), row);
    }
    user.stripe_id = null;
    if (typeof user.stripeId !== "function") user.stripeId = null;
    setTrialEndsAt(user, null);
    setPaymentMethod(user, null, null);
    await persistOwner(user);
    return this.successMethod();
  }

  async handleCustomerUpdated(
    payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    const data = payload.data.object as {
      id?: string;
      invoice_settings?: { default_payment_method?: string | null };
    };
    const user = await this.getUserByStripeId(data.id);
    if (!user) return this.successMethod();
    const pm = data.invoice_settings?.default_payment_method;
    if (pm && typeof pm === "string") {
      try {
        const method = (await Billing.stripe().request(
          `/v1/payment_methods/${pm}`,
        )) as { type?: string; card?: { last4?: string } };
        setPaymentMethod(user, method.type ?? "card", method.card?.last4 ?? null);
        await persistOwner(user);
      } catch {
        /* ignore Stripe lookup failures in webhook path */
      }
    }
    return this.successMethod();
  }

  /** invoice.payment_succeeded — ack; apps extend for custom side effects. */
  async handleInvoicePaymentSucceeded(
    _payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    return this.successMethod();
  }

  /** invoice.payment_failed — ack. */
  async handleInvoicePaymentFailed(
    _payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    return this.successMethod();
  }

  /** invoice.payment_action_required — ack (notifications optional / app-level). */
  async handleInvoicePaymentActionRequired(
    _payload: StripeWebhookEvent,
  ): Promise<WebhookHandlerResult> {
    return this.successMethod();
  }
}

/** Convenience: verify + dispatch in one call. */
export async function handleStripeWebhook(
  request: Request,
): Promise<Response> {
  return new WebhookController().handleRequest(request);
}
