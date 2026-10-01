---
title: Password Reset
description: Send reset links, store tokens, and update forgotten passwords with the Password broker.
---

# Password Reset

## Introduction

When a user forgets their password, you send a time-limited reset link, verify the token, then store a new hash. `@bunyad/auth` provides a password broker (`Password` / `PasswordBroker`), in-memory and database token stores, and status strings you can flash back to the form.

The framework wires a broker for you. When the app has sessions and a user model, `AuthServiceProvider` builds one from `config/auth.ts`: tokens live in the `password_reset_tokens` table, the link points at the `password.reset` route (`/reset-password/{token}?email=…`), and the `ResetPassword` notification (exported from `@bunyad/framework`) delivers it. Every web starter kit ships the routes, pages, and migration. Forms that change session state still need [CSRF protection](/docs/1.x/csrf).

## Configuration

The default broker reads the `passwords` entry named by `defaults.passwords`:

```ts title="config/auth.ts"
export default {
  defaults: { guard: "web", passwords: "users" },
  passwords: {
    users: {
      provider: "users",
      table: "password_reset_tokens",
      expire: 60,   // minutes a link stays valid
      throttle: 60, // seconds between reset mails for one address
    },
  },
};
```

To send a different mail, define `sendPasswordResetNotification(token)` on the user model; the default broker calls it instead of the `ResetPassword` notification.

To replace the broker entirely, set it in your provider's `boot()`. The framework sets its default while booting, so a broker set in `register()` would be overwritten:

```ts title="app/Providers/AppServiceProvider.ts"
import { ServiceProvider } from "@bunyad/core";
import { PasswordBroker, setPasswordBroker } from "@bunyad/auth";
import { Mail } from "@bunyad/mail";
import User from "@/Models/User.ts";

export default class AppServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    setPasswordBroker(
      new PasswordBroker({
        retrieveByCredentials: (email) => User.where("email", email).first(),
        createUrl: (email, token) =>
          `https://example.com/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
        sendResetNotification: async (user, _token, url) => {
          await Mail.raw(`Reset your password: ${url}`, String(user.email), "Reset your password");
        },
        expire: 60,
        throttle: 60,
      }),
    );
  }
}
```

| Option | Role |
| --- | --- |
| `retrieveByCredentials` | Load the user by email |
| `createUrl` | Build the link embedded in the email (default path-style URL if omitted) |
| `sendResetNotification` | Deliver the email or notification |
| `tokens` | Token repository (a hand-built broker defaults to an in-memory store; the framework's uses the database) |
| `expire` | Token lifetime in minutes (default `60`) |
| `throttle` | Minimum seconds between reset emails for the same address (default `60`) |

Use the `Password` façade anywhere in the app.

## Token repositories

### Memory

`MemoryPasswordTokenRepository` keeps hashed tokens in process memory. It is fine for tests and single-process apps. Pass it explicitly, or rely on the broker default when you omit `tokens`:

```ts
import { MemoryPasswordTokenRepository, PasswordBroker } from "@bunyad/auth";

new PasswordBroker({
  retrieveByCredentials: (email) => User.where("email", email).first(),
  tokens: new MemoryPasswordTokenRepository(60, 60),
});
```

The constructor arguments are expire minutes and throttle seconds.

### Database

`DatabasePasswordTokenRepository` stores rows in a table (default `password_reset_tokens`):

```sql
CREATE TABLE password_reset_tokens (
  email TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

```ts
import {
  DatabasePasswordTokenRepository,
  PasswordBroker,
} from "@bunyad/auth";

new PasswordBroker({
  retrieveByCredentials: (email) => User.where("email", email).first(),
  tokens: new DatabasePasswordTokenRepository({
    connection: {
      run: (sql, params) => db.run(sql, params),
      get: (sql, params) => db.get(sql, params),
    },
    table: "password_reset_tokens",
    expire: 60,
    throttle: 60,
  }),
});
```

Only the SHA-256 digest of the token is stored. The plain token is returned once from `create` / `sendResetLink` and must be emailed to the user.

## Routing

You need two pairs of routes: request a link, then submit a new password with the token.

### Requesting the reset link

Show a form with an `email` field:

```ts title="routes/web.ts"
import { Route } from "@bunyad/router";
import PasswordController from "@/Http/Controllers/PasswordController.ts";

Route.middleware("web").group(() => {
  Route.get("/forgot-password", [PasswordController, "showLinkRequest"])
    .middleware("guest")
    .name("password.request");

  Route.post("/forgot-password", [PasswordController, "sendResetLink"])
    .middleware("guest")
    .name("password.email");
});
```

Handle the form with `Password.sendResetLink`:

```ts title="app/Http/Controllers/PasswordController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Password } from "@bunyad/auth";

export default class PasswordController {
  async showLinkRequest(_request: Request) {
    return "forgot-password view";
  }

  async sendResetLink(request: Request) {
    const email = String(request.input("email") ?? "");

    const status = await Password.sendResetLink({ email });

    if (status === Password.ResetLinkSent) {
      request.session?.flash("status", status);
      return redirect("/forgot-password");
    }

    request.session?.flash("error", status);
    return redirect("/forgot-password");
  }
}
```

`sendResetLink` looks up the user, respects throttle, creates a token, builds the URL, and calls `sendResetNotification`. Possible statuses:

| Constant | Value | Meaning |
| --- | --- | --- |
| `Password.ResetLinkSent` | `passwords.sent` | Link created and notification invoked |
| `Password.ResetThrottled` | `passwords.throttled` | A token was created too recently |
| `Password.InvalidUser` | `passwords.user` | No user for that email |

Map these status strings to user-facing copy in your views.

### Resetting the password

The emailed link should open a form with `email`, `password`, `password_confirmation`, and a hidden `token`:

```ts
Route.get("/reset-password", [PasswordController, "showReset"])
  .middleware("guest")
  .name("password.reset");

Route.post("/reset-password", [PasswordController, "reset"])
  .middleware("guest")
  .name("password.update");
```

```ts
import { Hash, Password } from "@bunyad/auth";
import User from "@/Models/User.ts";

async reset(request: Request) {
  const email = String(request.input("email") ?? "");
  const password = String(request.input("password") ?? "");
  const token = String(request.input("token") ?? "");

  const status = await Password.reset(
    {
      email,
      password,
      password_confirmation: String(request.input("password_confirmation") ?? ""),
      token,
    },
    async (user, plain) => {
      const row = user as User;
      row.password = await Hash.make(plain);
      row.remember_token = null;
      await row.save();
    },
  );

  if (status === Password.PasswordReset) {
    request.session?.flash("status", status);
    return redirect("/login");
  }

  request.session?.flash("error", status);
  return redirect(`/reset-password?email=${encodeURIComponent(email)}`);
}
```

When the token and email are valid, the callback receives the user and the plain new password. Hash it yourself with `Hash.make`, then save. The broker deletes the token after a successful reset.

| Constant | Value | Meaning |
| --- | --- | --- |
| `Password.PasswordReset` | `passwords.reset` | Password updated |
| `Password.InvalidToken` | `passwords.token` | Token missing, wrong, or expired |
| `Password.InvalidUser` | `passwords.user` | No user for that email |

Validate length and confirmation in your form request or `request.validate` before calling `Password.reset`. The broker does not enforce password rules.

## Inspecting tokens

These helpers talk to the same repository the broker uses:

```ts
const token = await Password.createToken(user);
await Password.tokenExists(email, token);
await Password.deleteToken(email);

const status = await Password.validateReset({
  email,
  password: "unused",
  token,
});
// Password.PasswordReset means the token is valid

Password.getUser({ email });
Password.getRepository();
Password.broker(); // the PasswordBroker instance
```

`validateReset` returns `Password.PasswordReset` when the token is acceptable, without changing the password.

## Customizing the reset URL and email

`createUrl(email, token)` controls the link. `sendResetNotification(user, token, url)` controls delivery — mail, a notification class, a queue job, or a log in development.

The framework's default broker builds an absolute link from the `password.reset` route. A broker you build yourself without `createUrl` uses:

```
/reset-password?token=…&email=…
```

Always prefer an absolute URL in production so the email works outside the browser session that requested the reset.
