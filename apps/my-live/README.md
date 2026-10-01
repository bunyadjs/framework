# Live starter

The Views starter's pages rebuilt as `@bunyad/live` components: forms submit and re-render without a page reload, and sidebar links swap pages in place. Same features: sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion. Styled with DaisyUI on Tailwind.

## Create an app

From the Bunyad repo:

```bash
bun run bunyad new live apps/my-live
cd apps/my-live
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. Live signs component snapshots with it, so it must be set in production.

`bun run dev` starts the server with hot reload and rebuilds `public/build/app.css` as views change. `bun run build` builds the stylesheet once, minified, for production.

## How pages work

Each page is a component in `app/Live`, registered by its path (`app/Live/Auth/Login.ts` is `auth.login`) and routed as a full page:

```ts
Live.route("/login", "auth.login").name("login");
```

`static layout` picks the layout (`layouts.app` by default) and `static title` the page title. The component's view lives in `resources/views/live`. Forms use `live:submit="method"`, and inputs use `live:model.defer="field"`, which sends the value with the next action instead of on every keystroke.

Component actions post to `/live/update`, which does not run the page route's middleware. Actions that need a signed-in user call `currentUser()` from `app/Support/auth.ts` (401 when signed out), and two-factor actions call `ensurePasswordConfirmed()` (423 when the confirmation has expired).

The signed email-verification link and logout stay plain controllers. The dashboard and the appearance page are plain views.

## Routes

| Method | Path | Name / component | Auth |
|--------|------|------|------|
| GET | `/` | `home` | — |
| GET | `/dashboard` | `dashboard` | signed in, verified |
| GET | `/register` | `register` → `auth.register` | guest |
| GET | `/login` | `login` → `auth.login` | guest |
| GET | `/two-factor-challenge` | `two-factor.login` → `auth.two-factor-challenge` | guest, after the password step |
| GET | `/forgot-password` | `password.request` → `auth.forgot-password` | guest |
| GET | `/reset-password/{token}` | `password.reset` → `auth.reset-password` | guest |
| GET | `/email/verify` | `verification.notice` → `auth.verify-email` | signed in |
| GET | `/email/verify/{id}/{hash}` | `verification.verify` | signed in, signed URL |
| GET | `/confirm-password` | `password.confirm` → `auth.confirm-password` | signed in |
| POST | `/logout` | `logout` | signed in |
| GET | `/settings/profile` | `profile.edit` → `settings.profile` | signed in |
| GET | `/settings/password` | `password.edit` → `settings.password` | signed in |
| GET | `/settings/two-factor` | `two-factor.show` → `settings.two-factor` | signed in, password confirmed |
| GET | `/settings/appearance` | `appearance.edit` | signed in |
| POST | `/live/update` | `live.update` — every component action | per action |

Routes live in `routes/web.ts`, `routes/auth.ts`, and `routes/settings.ts`. Component actions all post to `/live/update`.

Login allows 5 failed attempts per email and IP per minute (`app/Live/Auth/Login.ts`). Registering signs the user in. Changing the email on the profile page marks it unverified.

## Two-factor authentication

Settings → Two-factor asks for the password, then shows a QR code for any TOTP app (1Password, Google Authenticator, Authy). Two-factor is on once the user enters a code from the app. After that, login asks for a code after the password, or one of eight single-use recovery codes. The secret and recovery codes are encrypted with `APP_KEY`, and each code works once.

The logic lives in `@bunyad/auth` (`TwoFactor`, `@TwoFactorAuthenticatable()` on `User`). The QR code, setup key, and recovery codes are rendered from the user on each update and never stored in the component snapshot. The columns come from `database/migrations/2026_09_27_000000_add_two_factor_columns_to_users_table.ts`.

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
