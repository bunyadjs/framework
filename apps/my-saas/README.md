# SaaS starter

The Views starter plus the parts most paid products need: Stripe subscriptions through `@bunyad/billing`, a queued welcome email, and an admin area. Everything in the Views starter is here too — sign up, login with remember me, two-factor authentication, password reset, email verification, password confirmation, and settings — styled with DaisyUI on Tailwind.

## Create an app

From the Bunyad repo:

```bash
bun run bunyad new saas apps/my-saas
cd apps/my-saas
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. Add your Stripe test keys to `.env` before trying the upgrade button.

## What the SaaS layer adds

| Area | Where |
| --- | --- |
| Billing | `/billing` (`BillingController`): upgrade through Stripe Checkout, manage the card in the Stripe billing portal. `User` is `Billable`; the plan columns come from `database/migrations/2026_09_28_000000_add_billing_columns_to_users_table.ts`. |
| Welcome email | Registering dispatches `SendWelcomeEmailJob`, which sends `WelcomeMail`. `QUEUE_CONNECTION=memory` runs jobs in process; use `database` or `redis` in production. |
| Admin | `/admin` behind `can:admin`. `AppServiceProvider` lets the first account in; replace the gate with a role check when you need more admins. The sidebar shows the link only to admins. |

## Stripe

```bash
STRIPE_KEY=pk_test_…
STRIPE_SECRET=sk_test_…
STRIPE_PRICE_PRO=price_…
APP_URL=http://localhost:3000
```

Checkout returns to `/billing?checkout=success`. In production, keep subscription state in sync with Stripe webhooks: `@bunyad/billing` stores rows when you call `newSubscription().create()` or sync them from events.

## Routes

| Method | Path | Name | Auth |
|--------|------|------|------|
| GET | `/` | `home` | — |
| GET | `/dashboard` | `dashboard` | signed in, verified |
| GET | `/billing` | `billing` | signed in |
| POST | `/billing/upgrade` | `billing.upgrade` | signed in |
| POST | `/billing/portal` | `billing.portal` | signed in |
| GET | `/admin` | `admin` | signed in, `can:admin` |
| GET/POST | `/register` | `register`, `register.store` | guest |
| GET/POST | `/login` | `login`, `login.store` | guest |
| GET/POST | `/two-factor-challenge` | `two-factor.login`, `two-factor.login.store` | guest, after the password step |
| GET/POST | `/forgot-password` | `password.request`, `password.email` | guest |
| GET | `/reset-password/{token}` | `password.reset` | guest |
| POST | `/reset-password` | `password.store` | guest |
| GET | `/email/verify` | `verification.notice` | signed in |
| GET | `/email/verify/{id}/{hash}` | `verification.verify` | signed in, signed URL |
| POST | `/email/verification-notification` | `verification.send` | signed in |
| GET/POST | `/confirm-password` | `password.confirm`, `password.confirm.store` | signed in |
| POST | `/logout` | `logout` | signed in |
| GET/PATCH/DELETE | `/settings/profile` | `profile.edit`, `profile.update`, `profile.destroy` | signed in |
| GET/PUT | `/settings/password` | `password.edit`, `password.update` | signed in |
| GET/POST/DELETE | `/settings/two-factor` | `two-factor.show`, `two-factor.enable`, `two-factor.disable` | signed in, password confirmed |
| POST | `/settings/two-factor/confirm` | `two-factor.confirm` | signed in, password confirmed |
| POST | `/settings/two-factor/recovery-codes` | `two-factor.recovery-codes` | signed in, password confirmed |
| GET | `/settings/appearance` | `appearance.edit` | signed in |

Routes live in `routes/web.ts`, `routes/auth.ts`, and `routes/settings.ts`.

Login allows 5 failed attempts per email and IP per minute (`LoginRequest`). Registering signs the user in. Changing the email on the profile page marks it unverified.

## Two-factor authentication

Settings → Two-factor asks for the password, then shows a QR code for any TOTP app (1Password, Google Authenticator, Authy). Two-factor is on once the user enters a code from the app. After that, login asks for a code after the password, or one of eight single-use recovery codes. The secret and recovery codes are encrypted with `APP_KEY`, and each code works once.

The logic lives in `@bunyad/auth` (`TwoFactor`, `@TwoFactorAuthenticatable()` on `User`). The columns come from `database/migrations/2026_09_27_000000_add_two_factor_columns_to_users_table.ts`.

## Email verification

Verification is off by default. Add `@MustVerifyEmail()` from `@bunyad/auth` to `app/Models/User.ts` and new users get a verification mail and must follow its link before `/dashboard` opens.

## Mail

Password reset and verification links go out as mail. `.env.example` sets `MAIL_MAILER=log` for local work. Set a real mailer before production.

## Appearance

Light, dark, or system. The choice is saved in the browser and applied before the first paint. Themes come from DaisyUI: `light` is the default and `dark` follows the OS setting.

`bunyad db:seed` runs `database/seeders/DatabaseSeeder.ts`, which creates `test@example.com` (password `password`).

## Test

```bash
bun test
```
