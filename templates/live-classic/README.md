# Live starter (classic layout)

The Views starter's pages rebuilt as `@bunyad/live-components` components: forms submit and re-render without a page reload, and sidebar links swap pages in place. Same features: sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion. Styled with DaisyUI on Tailwind.


## Create an app

```bash
bunyad new live my-live --structure=classic
# or, without the global CLI:
bun create bunyad my-live --kit=live --structure=classic
cd my-live
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. Live signs component snapshots with `APP_KEY`, so it must be set in production.

## Where things are

```text
app/Http/Controllers/   controllers, in `Auth/` and `Settings/`
app/Http/Requests/      form requests
app/Models/             models
resources/views/       the templates (`live/` holds each component's view, plus `layouts/`, `components/`)
app/Live/               the Live components, one class per screen
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
