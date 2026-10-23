# Vue starter (classic layout)

The same Vue app on Inertia as the Folders starter (sign up, log in, two-factor, password reset, email verification, a sidebar dashboard, settings), with the code grouped by kind.

## Create an app

```bash
bunyad new vue my-vue --structure=classic
# or, without the global CLI:
bun create bunyad my-vue --kit=vue --structure=classic
cd my-vue
bun install
bunyad migrate
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`.

## Where things are

```text
app/Http/Controllers/   controllers, in `Auth/` and `Settings/`
app/Http/Requests/      form requests
app/Http/Middleware/    HandleInertiaRequests (shared props)
app/Models/             models
routes/                 web.ts, auth.ts, settings.ts: every URL is written here
resources/js/           app.ts, pages/, layouts/, components/, hooks/
resources/css/app.css   the stylesheet
tests/                  feature tests
config/ database/ public/ server.ts
```

## How pages work

A route names its controller method, and the method renders a page by its path under `resources/js/pages`:

```ts
// routes/auth.ts
Route.get("/login", [AuthenticatedSessionController, "create"]).name("login");

// AuthenticatedSessionController
create() {
  return Inertia.render("auth/login");
}
```

`bunyad build` finds every file in `resources/js/pages` and loads each in its own chunk, so there is no page list to keep up to date. A page with no controller uses `Inertia.route("/dashboard", "dashboard")`. A page brings its own layout: `import AuthLayout from "~/layouts/AuthLayout.vue"`.

`@/` points at `app/`, `~/` at `resources/js/` (and the generated `.bunyad/`, so `~/routes` is the typed `route()` helper). `routes/web.ts` is loaded for you; `routes/api.ts`, if you add one, gets the `api` middleware group and the `/api` prefix.

## Moving to folders

The Folders layout puts a screen's controller, page, form request and tests in one `routes/<url>/` folder. Both layouts are supported by the framework and the CLI, and `make:controller` follows whichever your app uses (`bunyad.json`).
