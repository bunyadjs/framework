# SaaS starter (classic layout)

The Views starter plus the parts most paid products need: Stripe subscriptions through `@bunyad/billing`, a queued welcome email, and an admin area. Everything in the Views starter is here too — sign up, login with remember me, two-factor authentication, password reset, email verification, password confirmation, and settings — styled with DaisyUI on Tailwind.


## Where things are

```text
app/Http/Controllers/   controllers, in `Auth/` and `Settings/`
app/Http/Requests/      form requests
app/Models/             models
resources/views/       the pages (`auth/`, `settings/`, `billing/`, `admin/`, `layouts/`, `components/`)
app/Jobs, app/Mail     the queued welcome email
resources/css/app.css   the stylesheet
routes/                 web.ts, auth.ts, settings.ts: every URL is written here
tests/                  feature tests
config/ database/ public/ server.ts
```

## How pages work

A route names its controller method; the method returns a view by its dotted path under `resources/views`:

```ts
// routes/auth.ts
Route.get("/login", [AuthenticatedSessionController, "create"]).name("login");
```

`routes/web.ts` is loaded for you; `routes/api.ts`, if you add one, gets the `api` middleware group and the `/api` prefix. `bunyad dev` runs the server and Tailwind; `bunyad build` builds the stylesheet once.

## Moving to folders

The Folders layout puts a screen's controller, view, form request and tests in one `routes/<url>/` folder. Both layouts are supported by the framework and the CLI, and `make:controller` follows whichever your app uses (`bunyad.json`).
