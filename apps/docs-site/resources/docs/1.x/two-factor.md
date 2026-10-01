---
title: Two-Factor Authentication
description: Add authenticator-app codes, QR code setup, a login challenge, and recovery codes with TwoFactor from @bunyad/auth.
---

# Two-Factor Authentication

## Introduction

Two-factor authentication asks for a second proof after the password: a six-digit code from an authenticator app such as 1Password, Google Authenticator, or Authy. `@bunyad/auth` provides the pieces:

- time-based one-time passwords (TOTP, RFC 6238) with 30-second codes
- a secret and QR code for the user to scan
- eight single-use recovery codes for when the phone is lost
- `TwoFactor` actions to enable, confirm, disable, and check codes

The secret and the recovery codes are encrypted with your application key before they are stored, so [encryption](/docs/1.x/encryption) must be configured. The Views starter kit wires all of this up, with a settings page and a login challenge; the sections below show how it fits together.

## Database preparation

Add three nullable columns to `users`:

```ts title="database/migrations/2026_09_27_000000_add_two_factor_columns_to_users_table.ts"
import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.text("two_factor_secret").nullable();
    table.text("two_factor_recovery_codes").nullable();
    table.timestamp("two_factor_confirmed_at").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.dropColumn("two_factor_secret");
    table.dropColumn("two_factor_recovery_codes");
    table.dropColumn("two_factor_confirmed_at");
  });
}
```

| Column | Holds |
| --- | --- |
| `two_factor_secret` | The encrypted base32 secret |
| `two_factor_recovery_codes` | The encrypted JSON list of recovery codes |
| `two_factor_confirmed_at` | When the user proved their app works; two-factor is on only when this is set |

## Model preparation

Add `@TwoFactorAuthenticatable()` to the user model and merge its method types into the class:

```ts title="app/Models/User.ts"
import type { Authenticatable, TwoFactorAuthenticatableMethods } from "@bunyad/auth";
import { Authorizable, TwoFactorAuthenticatable } from "@bunyad/auth";
import { Model } from "@bunyad/orm";

@TwoFactorAuthenticatable()
export default class User extends Authorizable(Model) implements Authenticatable {
  declare two_factor_secret?: string | null;
  declare two_factor_recovery_codes?: string | null;
  declare two_factor_confirmed_at?: Date | null;

  static hidden = ["password", "remember_token", "two_factor_secret", "two_factor_recovery_codes"];
  static casts = { two_factor_confirmed_at: "datetime" } as const;
}

export default interface User extends TwoFactorAuthenticatableMethods {}
```

Keep the secret and the recovery codes in `hidden` so they never appear in JSON responses.

The decorator adds these methods:

| Method | Returns |
| --- | --- |
| `hasEnabledTwoFactorAuthentication()` | `true` when a secret is stored and confirmed |
| `twoFactorSecret()` | The decrypted base32 secret |
| `recoveryCodes()` | The decrypted recovery codes |
| `replaceRecoveryCode(code)` | Swaps one used code for a new one and saves |
| `twoFactorQrCodeUrl()` | The `otpauth://totp/…` URL authenticator apps read |
| `twoFactorQrCodeSvg()` | That URL as an inline SVG QR code |

The account name in the app is the user's email. The issuer is your `app.name` config value; call `setTwoFactorIssuer(name)` to change it.

## Enabling two-factor authentication

Turning two-factor on takes two steps, so a user never gets locked out by a secret their app didn't save:

1. `TwoFactor.enable(user)` stores a new secret and recovery codes. Login is unaffected.
2. The user scans the QR code, then enters the code their app shows. `TwoFactor.confirm(user, code)` checks it and sets `two_factor_confirmed_at`.

```ts title="app/Http/Controllers/Settings/TwoFactorController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { TwoFactor } from "@bunyad/auth";
import { route } from "@bunyad/router";
import { ValidationException } from "@bunyad/validation";
import { view } from "@bunyad/view";
import type User from "@/Models/User.ts";

export default class TwoFactorController {
  show(request: Request) {
    const user = request.user as User;
    const pending = Boolean(user.two_factor_secret) && !user.hasEnabledTwoFactorAuthentication();

    return view("settings.two-factor", {
      enabled: user.hasEnabledTwoFactorAuthentication(),
      pending,
      qrCodeSvg: pending ? user.twoFactorQrCodeSvg() : null,
      setupKey: pending ? user.twoFactorSecret() : null,
      recoveryCodes: user.two_factor_secret ? user.recoveryCodes() : [],
    });
  }

  async store(request: Request) {
    await TwoFactor.enable(request.user as User);
    return redirect(route("two-factor.show"));
  }

  async confirm(request: Request) {
    const { code } = await request.validate({ code: "required|string" });

    if (!(await TwoFactor.confirm(request.user as User, String(code)))) {
      throw ValidationException.withMessages({
        code: "The provided two factor authentication code was invalid.",
      });
    }

    return redirect(route("two-factor.show")).with("status", "two-factor-confirmed");
  }
}
```

Render the QR code unescaped, and show the setup key for users who can't scan:

```html title="resources/views/settings/two-factor.view"
@if(pending)
<div class="w-48 bg-white p-2">{!! qrCodeSvg !!}</div>
<p>Setup key: <code>{{ setupKey }}</code></p>

<form method="POST" action="{{ route('two-factor.confirm') }}">
  @csrf
  <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
  @error('code')<p>{{ message }}</p>@enderror
  <button type="submit">Confirm</button>
</form>
@endif
```

:::warning
Put these routes behind `password.confirm`. Otherwise anyone who finds an unlocked session could turn two-factor off or read the recovery codes. See [password confirmation](#password-confirmation).
:::

## Authenticating with two-factor

When a user with two-factor turned on submits the right password, don't log them in yet. Keep their id in the session and send them to a challenge page:

```ts title="app/Http/Controllers/Auth/AuthenticatedSessionController.ts"
async store(request: LoginRequest) {
  const user = await request.validateCredentials();
  const remember = request.boolean("remember");

  if (user.hasEnabledTwoFactorAuthentication()) {
    request.session!.put("login.id", user.id);
    request.session!.put("login.remember", remember);
    return redirect(route("two-factor.login"));
  }

  await Auth.login(request, user, remember);
  return redirect().intended(route("dashboard"));
}
```

`validateCredentials()` checks the password with `Auth.validate()` and returns `Auth.getLastAttempted(this)`, so no session is started until the second step passes.

The challenge accepts either an authenticator code or a recovery code, then logs in:

```ts title="app/Http/Controllers/Auth/TwoFactorChallengeController.ts"
async store(request: Request) {
  const user = await User.find(request.session!.get("login.id"));
  if (!user?.hasEnabledTwoFactorAuthentication()) return redirect(route("login"));

  const { code, recovery_code } = await request.validate({
    code: "nullable|string",
    recovery_code: "nullable|string",
  });

  const passed = recovery_code
    ? await TwoFactor.useRecoveryCode(user, String(recovery_code))
    : await TwoFactor.verify(user, String(code ?? ""));

  if (!passed) {
    throw ValidationException.withMessages({
      [recovery_code ? "recovery_code" : "code"]: "The provided code was invalid.",
    });
  }

  const remember = Boolean(request.session!.get("login.remember"));
  request.session!.forget("login.id");
  request.session!.forget("login.remember");
  await Auth.login(request, user, remember);

  return redirect().intended(route("dashboard"));
}
```

Throttle the challenge route so codes can't be guessed. There are a million possible codes and three are valid at any moment, so five tries a minute is plenty:

```ts title="routes/auth.ts"
Route.middleware("guest").group(() => {
  Route.get("/two-factor-challenge", [TwoFactorChallengeController, "create"])
    .name("two-factor.login");
  Route.post("/two-factor-challenge", [TwoFactorChallengeController, "store"])
    .middleware("throttle:5,1")
    .name("two-factor.login.store");
});
```

### How codes are checked

`TwoFactor.verify(user, code)` accepts the code for the current 30-second step, plus one step either side to allow for a phone clock that drifts. Spaces in the code are ignored.

Each code works once. After a code is accepted, that code and any older one are rejected for the same secret, so a code seen over someone's shoulder can't be replayed.

:::note
The record of used codes lives in the server's memory. If you run several app servers behind a load balancer, a code could be accepted once on each server within its 30-second window. Route login to one server, or keep sessions sticky, until a shared store is available.
:::

## Recovery codes

`TwoFactor.enable` creates eight recovery codes of the form `abcdefghij-klmnopqrst`. Show them once two-factor is on and ask the user to store them in a password manager.

`TwoFactor.useRecoveryCode(user, code)` accepts a code, replaces it with a fresh one, and saves, so each code signs in once and the user always has eight.

Let users start over with a new set:

```ts
await TwoFactor.regenerateRecoveryCodes(user);
```

## Disabling two-factor authentication

`TwoFactor.disable(user)` clears the secret, the recovery codes, and the confirmation time. The next login asks for the password only.

```ts
async destroy(request: Request) {
  await TwoFactor.disable(request.user as User);
  return redirect(route("two-factor.show")).with("status", "two-factor-disabled");
}
```

## Password confirmation

Group the settings routes under `password.confirm`. A user whose password confirmation has expired is sent to `/confirm-password`, then back to the page they asked for:

```ts title="routes/settings.ts"
Route.middleware("auth", "password.confirm").group(() => {
  Route.get("/settings/two-factor", [TwoFactorController, "show"]).name("two-factor.show");
  Route.post("/settings/two-factor", [TwoFactorController, "store"]).name("two-factor.enable");
  Route.post("/settings/two-factor/confirm", [TwoFactorController, "confirm"]).name("two-factor.confirm");
  Route.delete("/settings/two-factor", [TwoFactorController, "destroy"]).name("two-factor.disable");
  Route.post("/settings/two-factor/recovery-codes", [TwoFactorController, "regenerateRecoveryCodes"])
    .name("two-factor.recovery-codes");
});
```

The confirmation lasts three hours by default; set `password_timeout` (in seconds) in `config/auth.ts` to change it.

## Lower-level helpers

`TwoFactor` is built on functions you can use directly:

```ts
import { generateSecretKey, generateRecoveryCode, totp, verifyTotp } from "@bunyad/auth";

const secret = generateSecretKey(); // 32 base32 characters (160 bits)
const code = totp(secret);          // the six-digit code for now
verifyTotp(secret, code);           // the matching time step, or false
verifyTotp(secret, code, 0);        // no drift allowed
generateRecoveryCode();             // "abcdefghij-klmnopqrst"
```

`totp(secret, timestamp)` and `verifyTotp(secret, code, window, timestamp)` take a timestamp in milliseconds, which makes them easy to test at fixed times.

## Testing

In tests, generate the code the user's app would show with `totp(user.twoFactorSecret())`:

```ts title="tests/two-factor.test.ts"
import { expect, test } from "bun:test";
import { TwoFactor, totp } from "@bunyad/auth";
import User from "@/Models/User.ts";

test("users with two-factor enter a code after their password", async () => {
  const app = await client(); // resets the database, so create users after it
  const user = await User.factory().create({ email: "ada@example.com" });
  await TwoFactor.enable(user);
  user.two_factor_confirmed_at = new Date();
  await user.save();

  (await app.post("/login", { email: "ada@example.com", password: "password" }))
    .assertRedirect("/two-factor-challenge");

  (await app.post("/two-factor-challenge", { code: totp(user.twoFactorSecret()) }))
    .assertRedirect("/dashboard");
});
```

Set `APP_KEY` in the test environment, because the secret is encrypted.
