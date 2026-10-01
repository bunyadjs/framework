---
title: Email Verification
description: Require users to verify their email with signed links and the verified middleware.
---

# Email Verification

## Introduction

Many apps require a verified email before the user can use the product. Bunyad ships helpers on `@bunyad/auth` for the user contract, signed verification URLs, fulfilling a click, sending the message, and blocking unverified users with middleware.

You wire the routes. The framework sends the mail: `AuthServiceProvider` registers a sender that delivers the `VerifyEmail` notification, and a `Registered` listener that sends it after sign-up. Every web starter kit ships these routes and pages; verification turns on when `User` takes `@MustVerifyEmail()`.

## Model preparation

Mark the user class with `@MustVerifyEmail()` and keep an `email_verified_at` column. The decorator attaches `hasVerifiedEmail`, `markEmailAsVerified`, `markEmailAsUnverified`, and `getEmailForVerification`.

```ts title="app/Models/User.ts"
import type { Authenticatable } from "@bunyad/auth";
import { Authorizable, MustVerifyEmail } from "@bunyad/auth";
import { Model } from "@bunyad/orm";

@MustVerifyEmail()
export default class User
  extends Authorizable(Model)
  implements Authenticatable
{
  declare email: string;
  declare email_verified_at?: string | null;
  // …
}
```

By default the email attribute is `email`. Pass another attribute name when needed: `@MustVerifyEmail("work_email")`.

You can also spread `mustVerifyEmailMethods(() => this.email)` onto a plain object in tests.

`isMustVerifyEmail(user)` is true when the instance has the required methods.

### Database

Store verification time on `users.email_verified_at` (nullable timestamp). The starter kits' users migration includes that column.

`hasVerifiedEmail()` is true when `email_verified_at` is set and not an empty string. `markEmailAsVerified()` writes an ISO timestamp and calls `save()` when present. `markEmailAsUnverified()` clears the column the same way.

## Building the verification URL

`verificationUrl(user)` creates a temporary signed URL for the named route `verification.verify` (override with `route`). The path parameters are the user's `id` and a SHA-1 `hash` of `getEmailForVerification()`.

```ts
import { verificationUrl, verificationHash } from "@bunyad/auth";

const url = await verificationUrl(user);
// /email/verify/{id}/{hash}?expires=…&signature=…

const urlAbsolute = await verificationUrl(user, {
  expire: 60,
  absolute: true,
  route: "verification.verify",
});
```

| Option | Default | Role |
| --- | --- | --- |
| `route` | `verification.verify` | Named route that accepts `{id}` and `{hash}` |
| `expire` | `60` | Minutes until the signature expires |
| `absolute` | `false` | Full URL when `true` |

`verificationHash(email)` is the same hash used in the URL. Signed URLs need your app key configured the same way as other [URL generation](/docs/1.x/urls) features.

## Sending the verification email

After registration, dispatch the `Registered` event; the framework's listener sends the verification mail to users that implement the contract and are not verified yet:

```ts
import { Auth, Registered } from "@bunyad/auth";
import { event } from "@bunyad/events";

const user = await User.create(data);
await event(new Registered(user));
await Auth.login(request, user);
```

Call `sendEmailVerificationNotification(user)` yourself to resend a link.

1. If the user defines `sendEmailVerificationNotification()`, that method runs.
2. Otherwise Bunyad calls the sender registered with `setEmailVerificationSender`. By default that sends the `VerifyEmail` notification (exported from `@bunyad/framework`) with an absolute signed link.

```ts
import {
  setEmailVerificationSender,
  sendEmailVerificationNotification,
  verificationUrl,
} from "@bunyad/auth";
import type { MustVerifyEmail } from "@bunyad/auth";

// Replace the default VerifyEmail notification, e.g. in AppServiceProvider.boot():
setEmailVerificationSender(async (user: MustVerifyEmail, url: string) => {
  // Send mail with `url` (Mail, Notification, or your own client)…
});

await sendEmailVerificationNotification(user);
```

If neither the user method nor a sender is set (for example, `@bunyad/auth` used without the framework), `sendEmailVerificationNotification` throws.

`fulfillEmailVerification` dispatches the `Verified` event when it marks an address verified.

## Routing

Define three routes: a notice page, the signed verify handler, and an optional resend endpoint.

### Verification notice

Show this page when an unverified user hits a protected route. Name is up to you; the `verified` middleware redirects to a path (default `/email/verify`), not a route name.

```ts
import { auth } from "@bunyad/auth";
import { view } from "@bunyad/view";

Route.get("/email/verify", (request) => {
  return view("auth.verify-email");
})
  .middleware(auth())
  .name("verification.notice");
```

### Verification handler

The link in the email must hit a route named `verification.verify` with `{id}` and `{hash}`. Require authentication. Prefer the `signed` middleware from `@bunyad/router` as well; `fulfillEmailVerification` also checks `request.hasValidSignature()`.

```ts
import { auth, fulfillEmailVerification } from "@bunyad/auth";
import { redirect } from "@bunyad/http";
import { signed } from "@bunyad/router";

Route.get("/email/verify/{id}/{hash}", async (request) => {
  await fulfillEmailVerification(request);
  return redirect("/dashboard");
})
  .middleware([auth(), signed()])
  .name("verification.verify");
```

`fulfillEmailVerification(request)` loads the authenticated user (or accepts a second `user` argument). It aborts with 403 when:

- the user is missing or does not implement the verification contract
- the signature is invalid
- the route `id` does not match the user
- the route `hash` does not match `verificationHash` of the current email

It returns `true` when the email was newly marked verified, and `false` when it was already verified.

### Resending the link

```ts
import { auth, sendEmailVerificationNotification } from "@bunyad/auth";
import type { MustVerifyEmail } from "@bunyad/auth";
import { redirect } from "@bunyad/http";

Route.post("/email/verification-notification", async (request) => {
  const user = await request.user();
  await sendEmailVerificationNotification(user as MustVerifyEmail);
  return redirect("/email/verify");
})
  .middleware(auth())
  .name("verification.send");
```

Throttle this route in production so it cannot be abused.

## Protecting routes

`verified` ensures the current user has a verified email. Pair it with `auth`:

```ts
import { auth, verified } from "@bunyad/auth";

Route.middleware([auth(), verified()]).group(() => {
  Route.get("/dashboard", [DashboardController, "index"]);
});
```

Behavior when the check fails:

| Client | Guest | Unverified user |
| --- | --- | --- |
| Browser and Inertia visits | Redirect to `redirectTo` (default `/email/verify`) | Same redirect |
| Clients that expect JSON (`request.expectsJson()`) | 401 | 409 with `Your email address is not verified.` |

Override the redirect path:

```ts
verified({ redirectTo: "/email/verify" });
```

The string alias `verified` accepts an optional path: `verified:/email/verify`.

Users that do not implement the verification contract are treated as verified by this middleware (only `MustVerifyEmail` users are blocked when unverified).

## Customizing delivery

The default mail is the `VerifyEmail` notification. Customize by:

- implementing `sendEmailVerificationNotification` on the user, or
- calling `setEmailVerificationSender((user, url) => { … })` in your provider's `boot()` (it runs after the framework's)

Build a different URL with `verificationUrl` options, then pass that URL into your mailer from the sender. Clear the sender in tests with `setEmailVerificationSender(undefined)`.
