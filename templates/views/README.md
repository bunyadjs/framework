# Views starter

Server-rendered app on `.view` files, styled with DaisyUI on Tailwind. It ships sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion.

## Create an app

From the Bunyad repo:

```bash
bun run bunyad new views apps/my-app
cd apps/my-app
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. In an existing app, run `bunyad key:generate`.

`bun run dev` (`bunyad dev`) starts the server with hot reload and rebuilds `public/build/app.css` as views change. `bun run build` (`bunyad build`) builds the stylesheet once, minified, for production.

## Routes

| Method | Path | Name | Auth |
|--------|------|------|------|
| GET | `/` | `home` | — |
| GET | `/dashboard` | `dashboard` | signed in, verified |
| GET/POST | `/register` | `register`, `register.store` | guest |
| GET/POST | `/login` | `login`, `login.store` | guest |
| GET/POST | `/two-factor-challenge` | `two-factor-challenge`, `two-factor-challenge.store` | guest, after the password step |
| GET/POST | `/forgot-password` | `forgot-password`, `forgot-password.store` | guest |
| GET | `/reset-password/{token}` | `password.reset` | guest |
| POST | `/reset-password` | `password.store` | guest |
| GET | `/email/verify` | `email.verify` | signed in |
| GET | `/email/verify/{id}/{hash}` | `verification.verify` | signed in, signed URL |
| POST | `/email/verification-notification` | `email.verification-notification.store` | signed in |
| GET/POST | `/confirm-password` | `confirm-password`, `confirm-password.store` | signed in |
| POST | `/logout` | `logout` | signed in |
| GET/PATCH/DELETE | `/settings/profile` | `settings.profile`, `settings.profile.update`, `settings.profile.destroy` | signed in |
| GET/PUT | `/settings/password` | `settings.password`, `settings.password.update` | signed in |
| GET/POST/DELETE | `/settings/two-factor` | `two-factor.show`, `two-factor.enable`, `two-factor.disable` | signed in, password confirmed |
| POST | `/settings/two-factor/confirm` | `two-factor.confirm` | signed in, password confirmed |
| POST | `/settings/two-factor/recovery-codes` | `two-factor.recovery-codes` | signed in, password confirmed |
| GET | `/settings/appearance` | `settings.appearance` | signed in |

## Where things are

```text
routes/      URLs: a controller, a page (`LoginPage.view`) and form requests per folder, their tests in `_tests/` folders,
             the layouts (`MainLayout.view`, `(auth)/AuthLayout.view`, …), and `_components` for `<x-…>` components
             (folders starting with `_` are not routes) and `app.css`
app/         code with no URL: Models, the Testing helper
config/      configuration, one file per concern
database/    migrations, seeders
public/      files served as they are, and the build output
server.ts    boots the app, and serves it when run
```

A folder in `routes/` is a URL. `routes/(auth)/login/LoginPage.view` is `/login`; `(auth)` adds no URL segment: it groups the sign-in pages that share one controller. Who may open each page is in `routes/(auth)/auth.routes.ts` and `routes/app.routes.ts`. An action with no page (logout, the resend button, the signed verification link) is declared on the area's controller, `routes/(auth)/AuthController.ts`.

## How pages work

A controller returns the data of its page, and the `*Page.view` in the same folder renders it. A page with no data needs no method for it, so `login/` has only `store()`:

```ts
// routes/(app)/settings/profile/ProfileController.ts
edit(request: Request) {
  return { mustVerifyEmail };   // variables of ProfilePage.view in the same folder
}
```

A page says what its layouts show with `@meta`:

```text
@meta({ title: "Profile settings", heading: "Profile", subheading: "Update your name and email address" })
```

A `*Layout.view` in a folder wraps every page in that folder and in the folders below it, outermost first: `routes/MainLayout.view` wraps everything (the document, `<head>` and title), then `(auth)/AuthLayout.view` wraps the sign-in pages, and `(app)/AppLayout.view` then `(app)/settings/SettingsLayout.view` wrap the settings pages. A layout prints the page with `{!! children !!}` and reads `meta`.

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
