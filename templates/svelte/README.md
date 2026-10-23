# Svelte starter

The Views starter's features as a Svelte app on Inertia: sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion. Controllers stay on the server; pages are Svelte components that swap without full reloads. Styled with DaisyUI on Tailwind.

## Create an app

```bash
bunyad new svelte my-svelte
cd my-svelte
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`.

`bun run dev` (`bunyad dev`) runs four processes: the server with hot reload, the frontend bundle rebuilding as `routes` changes, typed routes regenerating, and Tailwind rebuilding `public/build/app.css`. `bun run build` (`bunyad build`) builds the bundle and the stylesheet once, minified when `NODE_ENV=production`.

## Where things are

```text
routes/      URLs: a controller, pages and form requests per folder, their tests in `_tests/` folders, the layouts
             (`MainLayout.svelte`, `(auth)/AuthLayout.svelte`, …), and the shared UI in `_components` and `_lib`
             (folders starting with `_` are not routes) and `app.css`
app/         code with no URL: Models, Http/Middleware, the Testing helper
config/      configuration, one file per concern
database/    migrations, seeders
public/      files served as they are, and the build output
server.ts    boots the app, and serves it when run
```

A folder in `routes/` is a URL. `routes/(auth)/login/LoginPage.svelte` is `/login`; `(auth)` adds no URL segment: it groups the sign-in pages that share one controller. Who may open each page is in `routes/(auth)/auth.routes.ts` and `routes/app.routes.ts`.

## How pages work

A folder is a URL with one page, and its controller sits beside it with plain names: `show()` is the data of the page, `store()` is its form post, `update()` and `destroy()` are the other verbs. A controller returns the page's props, and the view in the folder renders them. A page with no data needs no method for it, so `login/` has only `store()`:

```ts
// routes/(app)/settings/two-factor/TwoFactorController.ts
show(request: Request) {
  return { enabled, recoveryCodes };   // props of TwoFactorPage.svelte in the same folder
}
```

`bunyad build` finds every `*Page.svelte` under `routes` and loads each one in its own chunk, so there is no page list to keep up to date. A folder with a page and no controller (`dashboard/DashboardPage.svelte`) is a page by itself.

`app/Http/Middleware/HandleInertiaRequests.ts` shares `name`, `auth.user`, and the flashed `status` with every page; validation errors arrive as `errors` (`{ field: "first message" }`). Forms use Inertia's `useForm`. `@/` points at `app/`; `~/` points at `routes/`, so a page imports shared UI as `~/_components/Field.svelte` and the typed `route()` helper as `~/routes`.

## Tests and types

Tests sit in a `_tests/` subfolder beside the code they cover (`routes/(auth)/_tests/auth.test.ts`); the router ignores it. Types used by one folder go in a `_types.ts` there and shared ones in `routes/_types.ts`. Everything generated (`route()`, shared props, page props, the `virtual:pages` declaration) is in `.bunyad/` and is never edited.

## Layouts

A `*Layout.svelte` in a folder wraps every page in that folder and in the folders below it, outermost first: `routes/MainLayout.svelte` wraps everything, then `(auth)/AuthLayout.svelte` wraps the sign-in pages, and `(app)/AppLayout.svelte` then `(app)/settings/SettingsLayout.svelte` wrap the settings pages. A page does not import its layout. It says what the layout shows:

```tsx
export const meta = { title: "Log in to your account", description: "Enter your email and password below to log in" };
```

`meta` can also be a function of the page props. A layout receives it as `meta`. A layout that exports `reset = true` ignores the layouts above it, and a page that sets its own `layout` keeps it. Layouts stay mounted while you move between pages that share them.

## Typed routes and props

`bunyad types:generate` (also `bun run types`; `bun run dev` keeps it running) writes three files from the app itself:

| File | What it gives you |
|---|---|
| `.bunyad/routes.ts` | `route("password.reset", { token })`: every named route, with its parameters checked. A missing parameter or an unknown name is a type error; other keys become the query string. |
| `.bunyad/shared.d.ts` | `SharedData`: exactly what `HandleInertiaRequests.share()` returns, plus `errors`. `usePage<SharedData>()` follows the server. |
| `.bunyad/inertia.d.ts` | Each page's props, read from the page component (React pages only; Vue and Svelte pages are not typed yet). An explicit `Inertia.render("settings/profile/ProfilePage", { mustVerifyEmail })` is checked: an unknown page, a missing or misspelled prop, or a wrong type is a type error in the controller. |

The page component is the source of truth for its props:

```tsx
// routes/settings/profile/ProfilePage.svelte
export default function Profile({ mustVerifyEmail }: { mustVerifyEmail: boolean }) { … }
```

```ts
// routes/(app)/settings/profile/ProfileController.ts
return Inertia.render("settings/profile/ProfilePage", { mustVerifyEmail: true }); // checked, for the rare action that renders by name
```

Pages use `route()` instead of URLs: `form.patch(route("settings.profile.update"))`, `<Link href={route("dashboard")}>`. Rename a route or a URL in `src` and the frontend follows; remove a route and every use of it fails to type-check. The generated files are committed, so a fresh clone builds before anything runs.

## Server-side rendering

The first visit to each page is rendered on the server, in the same process, and hydrated in the browser: the page arrives as HTML, then later visits stay client-side. It is on in `config/inertia.ts`; `INERTIA_SSR_ENABLED=0` turns it off. The renderer is `app/Http/inertia-ssr.ts`, and it loads pages straight from their folders under `routes`.

Code in a component's first render also runs on the server, where there is no `window`, `document`, or `localStorage`: read browser-only values after hydration, as the appearance setting does.

## Routes

| Method | Path | Name | Auth |
|--------|------|------|------|
| GET | `/` | `home` (`welcome`) | — |
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

Routes live in `routes`: each folder is a URL with its controller, form request and page (`routes/(auth)/login/` has `LoginController.ts`, `LoginRequest.ts` and `LoginPage.svelte`). An action with no page (logout, the resend button, the signed verification link) has no folder: it is declared on the area's controller, `routes/(auth)/AuthController.ts`, with `@Post("/logout")`. Who may open what is in `auth.routes.ts` and `app.routes.ts`. A controller in a parent folder can also serve the folders below it, matched by method name, when several pages share one.

Login allows 5 failed attempts per email and IP per minute (`LoginRequest`). Registering signs the user in. Changing the email on the profile page marks it unverified.

## Two-factor authentication

Settings → Two-factor asks for the password, then shows a QR code for any TOTP app (1Password, Google Authenticator, Authy). Two-factor is on once the user enters a code from the app. After that, login asks for a code after the password, or one of eight single-use recovery codes. The secret and recovery codes are encrypted with `APP_KEY`, and each code works once.

The logic lives in `@bunyad/auth` (`TwoFactor`, `@TwoFactorAuthenticatable()` on `User`). The columns come from `database/migrations/2026_09_27_000000_add_two_factor_columns_to_users_table.ts`.

## Email verification

Verification is off by default. Add `@MustVerifyEmail()` from `@bunyad/auth` to `app/Models/User.ts` and new users get a verification mail and must follow its link before `/dashboard` opens.

## Mail

Password reset and verification links go out as mail. `.env.example` sets `MAIL_MAILER=log` for local work. Set a real mailer before production.

## Appearance

Light, dark, or system. The choice is saved in the browser (`routes/_lib/appearance.svelte.ts`) and applied before the first paint by a small script in the default root page. Themes come from DaisyUI: `light` is the default and `dark` follows the OS setting.

`bunyad db:seed` runs `database/seeders/DatabaseSeeder.ts`, which creates `test@example.com` (password `password`).

## Test

```bash
bun test
```
