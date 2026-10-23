# Views starter (classic layout)

Server-rendered app on `.view` files, styled with DaisyUI on Tailwind. It ships sign up, log in, remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion.


## Create an app

```bash
bunyad new views my-views --structure=classic
# or, without the global CLI:
bun create bunyad my-views --kit=views --structure=classic
cd my-views
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`.

## Where things are

```text
app/Http/Controllers/   controllers, in `Auth/` and `Settings/`
app/Http/Requests/      form requests
app/Models/             models
resources/views/       the pages (`auth/`, `settings/`, `layouts/`, `components/`, `partials/`)
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
