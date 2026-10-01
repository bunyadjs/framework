import { createHash } from "node:crypto";
import type { Request, Next } from "@bunyad/http";
import {
  abort,
  aliasMiddleware,
  redirect,
  taggedMiddleware,
} from "@bunyad/http";
import type { Authenticatable } from "./guard.ts";
import { Auth } from "./guard.ts";
import { dispatchAuthEvent, Verified } from "./events.ts";

/**
 * Contract for users that must verify their email address.
 */
export type MustVerifyEmail = Authenticatable & {
  email_verified_at?: string | Date | null;
  hasVerifiedEmail(): boolean;
  markEmailAsVerified(): boolean | Promise<boolean>;
  markEmailAsUnverified(): boolean | Promise<boolean>;
  getEmailForVerification(): string;
  sendEmailVerificationNotification(): void | Promise<void>;
};

export function isMustVerifyEmail(user: unknown): user is MustVerifyEmail {
  return (
    user != null &&
    typeof user === "object" &&
    typeof (user as MustVerifyEmail).hasVerifiedEmail === "function" &&
    typeof (user as MustVerifyEmail).markEmailAsVerified === "function" &&
    typeof (user as MustVerifyEmail).getEmailForVerification === "function" &&
    typeof (user as MustVerifyEmail).sendEmailVerificationNotification ===
      "function"
  );
}

/** SHA-1 hash of the email (used in verification URLs). */
export function verificationHash(email: string): string {
  return createHash("sha1").update(email).digest("hex");
}

export type VerificationUrlOptions = {
  /** Named route (default `verification.verify`). */
  route?: string;
  /** Minutes until the link expires (default 60). */
  expire?: number;
  /** Absolute URL. */
  absolute?: boolean;
};

/**
 * Build a temporary signed verification URL for the user.
 * Route should accept `{id}` and `{hash}` parameters.
 */
export async function verificationUrl(
  user: MustVerifyEmail,
  options: VerificationUrlOptions = {},
): Promise<string> {
  const { Url } = await import("@bunyad/router");
  const name = options.route ?? "verification.verify";
  const hash = verificationHash(user.getEmailForVerification());
  return Url.temporarySignedRoute(
    name,
    options.expire ?? 60,
    { id: user.id, hash },
    options.absolute ?? false,
  );
}

export type EmailVerificationSender = (
  user: MustVerifyEmail,
  url: string,
) => void | Promise<void>;

let emailVerificationSender: EmailVerificationSender | undefined;

export function setEmailVerificationSender(
  sender: EmailVerificationSender | undefined,
): void {
  emailVerificationSender = sender;
}

async function deliverViaRegisteredSender(
  user: MustVerifyEmail,
): Promise<void> {
  if (!emailVerificationSender) {
    throw new Error(
      "No email verification sender configured. Call setEmailVerificationSender() or implement sendEmailVerificationNotification() on the user.",
    );
  }
  const url = await verificationUrl(user, { absolute: true });
  await emailVerificationSender(user, url);
}

/**
 * Send the verification notification (delegates to the user's
 * `sendEmailVerificationNotification`, falling back to the registered sender).
 */
export async function sendEmailVerificationNotification(
  user: MustVerifyEmail,
): Promise<void> {
  const send = user.sendEmailVerificationNotification;
  if (typeof send === "function") {
    await send.call(user);
    return;
  }
  await deliverViaRegisteredSender(user);
}

/**
 * Mark the authenticated user's email verified when the signed URL is valid.
 * Returns true when the email was newly marked verified.
 */
export async function fulfillEmailVerification(
  request: Request,
  user?: MustVerifyEmail | null,
): Promise<boolean> {
  const current =
    user ??
    ((await Auth().user(request)) as MustVerifyEmail | null | undefined);
  if (!current || !isMustVerifyEmail(current)) {
    abort(403);
  }

  if (!request.hasValidSignature()) {
    abort(403, "Invalid signature.");
  }

  const id = String(request.route("id") ?? "");
  const hash = String(request.route("hash") ?? "");
  if (String(current.id) !== id) {
    abort(403);
  }
  if (hash !== verificationHash(current.getEmailForVerification())) {
    abort(403);
  }

  if (current.hasVerifiedEmail()) {
    return false;
  }
  await current.markEmailAsVerified();
  await dispatchAuthEvent(new Verified(current));
  return true;
}

export type VerifiedMiddlewareOptions = {
  /** Redirect guests / unverified HTML clients here (default `/email/verify`). */
  redirectTo?: string;
};

/**
 * Ensure the authenticated user has a verified email (`verified` middleware).
 */
export function verified(options: VerifiedMiddlewareOptions = {}) {
  const redirectTo = options.redirectTo ?? "/email/verify";
  return taggedMiddleware("verified", {
    async handle(request: Request, next: Next) {
      const user = await Auth().user(request);
      if (!user) {
        if (request.expectsJson()) abort(401);
        return redirect(redirectTo);
      }
      if (isMustVerifyEmail(user) && !user.hasVerifiedEmail()) {
        if (request.expectsJson())
          abort(409, "Your email address is not verified.");
        return redirect(redirectTo);
      }
      return next();
    },
  });
}

aliasMiddleware("verified", (...params: string[]) => {
  return verified(params[0] ? { redirectTo: params[0] } : {});
});

/** Methods `@MustVerifyEmail()` / `mustVerifyEmailMethods()` add to a model. */
export type MustVerifyEmailMethods = {
  hasVerifiedEmail(): boolean;
  markEmailAsVerified(): boolean | Promise<boolean>;
  markEmailAsUnverified(): boolean | Promise<boolean>;
  getEmailForVerification(): string;
  sendEmailVerificationNotification(): void | Promise<void>;
};

/**
 * Mixin helpers for models that store `email_verified_at`.
 */
export function mustVerifyEmailMethods(
  getEmail: () => string,
): MustVerifyEmailMethods {
  return {
    hasVerifiedEmail(this: { email_verified_at?: string | Date | null }) {
      return this.email_verified_at != null && this.email_verified_at !== "";
    },
    async markEmailAsVerified(this: {
      email_verified_at?: string | Date | null;
      save?: () => void | Promise<void>;
    }) {
      this.email_verified_at = new Date().toISOString();
      await this.save?.();
      return true;
    },
    async markEmailAsUnverified(this: {
      email_verified_at?: string | Date | null;
      save?: () => void | Promise<void>;
    }) {
      this.email_verified_at = null;
      await this.save?.();
      return true;
    },
    getEmailForVerification() {
      return getEmail.call(this);
    },
    async sendEmailVerificationNotification(this: MustVerifyEmail) {
      await deliverViaRegisteredSender(this);
    },
  };
}

/**
 * Attach verification helpers to the model prototype (`hasVerifiedEmail`, …).
 *
 * @example
 * ```ts
 * @MustVerifyEmail()
 * class User extends Model {
 *   declare email: string;
 *   declare email_verified_at?: string | null;
 * }
 * ```
 */
export function MustVerifyEmail(emailAttribute = "email"): ClassDecorator {
  return (target) => {
    const proto = target.prototype as Record<string, unknown>;
    const helpers = mustVerifyEmailMethods(function (
      this: Record<string, unknown>,
    ) {
      return String(this[emailAttribute] ?? "");
    });
    Object.assign(proto, helpers);
  };
}
