# React starter

The Views starter's features as a React app on Inertia: sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion. Controllers stay on the server; pages are React components that swap without full reloads. Styled with DaisyUI on Tailwind.

## Create an app

From the Bunyad repo:

```bash
bun run bunyad new react apps/my-react
cd apps/my-react
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`.

`bun run dev` runs three processes: the server with hot reload, the frontend bundle rebuilding as `resources/js` changes, and Tailwind rebuilding `public/build/app.css`. `bun run build` builds both once, minified when `NODE_ENV=production`.

## How pages work

A controller renders a page by its path under `resources/js/pages`:

```ts
return Inertia.render("settings/two-factor", { enabled, recoveryCodes });
```

`scripts/build.ts` finds every page and loads each one in its own chunk, so there is no page list to keep up to date. Pages without a controller use `Inertia.route("/dashboard", "dashboard")`.

`app/Http/Middleware/HandleInertiaRequests.ts` shares `name`, `auth.user`, and the flashed `status` with every page; validation errors arrive as `errors` (`{ field: "first message" }`). Forms use Inertia's `useForm`. Inside `resources/js`, `@/` points at `resources/js`.

## Typed routes and props

`bunyad types:generate` (also `bun run types`; `bun run dev` keeps it running) writes three files from the app itself:

| File | What it gives you |
|---|---|
| `resources/js/routes.ts` | `route("password.reset", { token })`: every named route, with its parameters checked. A missing parameter or an unknown name is a type error; other keys become the query string. |
| `resources/js/types/shared.d.ts` | `SharedData`: exactly what `HandleInertiaRequests.share()` returns, plus `errors`. `usePage<SharedData>()` follows the server. |
| `types/inertia.d.ts` | Each page's props, read from the page component. `Inertia.render("settings/profile", { mustVerifyEmail })` is checked: an unknown page, a missing or misspelled prop, or a wrong type is a type error in the controller. |

The page component is the source of truth for its props:

```tsx
// resources/js/pages/settings/profile.tsx
export default function Profile({ mustVerifyEmail }: { mustVerifyEmail: boolean }) { … }
```

```ts
// app/Http/Controllers/Settings/ProfileController.ts
return Inertia.render("settings/profile", { mustVerifyEmail: true }); // checked
```

Pages use `route()` instead of URLs: `form.patch(route("profile.update"))`, `<Link href={route("dashboard")}>`. Rename a route or a URL in `routes/` and the frontend follows; remove a route and every use of it fails to type-check. The generated files are committed, so a fresh clone builds before anything runs.

## Server-side rendering

The first visit to each page is rendered on the server, in the same process, and hydrated in the browser: the page arrives as HTML, then later visits stay client-side. It is on in `config/inertia.ts`; `INERTIA_SSR_ENABLED=0` turns it off. The renderer is `bootstrap/inertia-ssr.tsx`, and it loads pages straight from `resources/js/pages`.

Code in a component's first render also runs on the server, where there is no `window`, `document`, or `localStorage`: read browser-only values after hydration, as the appearance setting does.

## Routes

| Method | Path | Name | Auth |
|--------|------|------|------|
| GET | `/` | `home` (`welcome`) | — |
| GET | `/dashboard` | `dashboard` | signed in, verified |
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

Light, dark, or system. The choice is saved in the browser (`resources/js/hooks/use-appearance.ts`) and applied before the first paint by `resources/views/app.view`. Themes come from DaisyUI: `light` is the default and `dark` follows the OS setting.

`bunyad db:seed` runs `database/seeders/DatabaseSeeder.ts`, which creates `test@example.com` (password `password`).

## Test

```bash
bun test
```
