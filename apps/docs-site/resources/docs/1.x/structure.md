---
title: Directory Structure
description: The folders in a Bunyad application and what each one is for.
---

# Directory Structure

## Introduction

The starter kits are a starting point for a small application and a large one. The folders below are the Views starter's; the other kits differ where noted. You can move a class when you have a reason to. Bunyad does not require a particular filename as long as the route file imports it.

## The root directory

```text
my-app/
  app/
  bootstrap/
  config/
  database/
  public/
  resources/
  routes/
  scripts/
  storage/
  tests/
  server.ts
```

### The app directory

`app` holds the code you write for this application: controllers, form requests, models, and service providers. Almost every class that is unique to the app belongs here.

Import from `app/` with the `@/` alias (configured in the app `tsconfig.json` as `@/*` → `app/*`):

```ts
import User from "@/Models/User.ts";
import FlightController from "@/Http/Controllers/FlightController.ts";
```

Bun and the route-binding scanner resolve the same alias, so docs samples and controllers stay in sync.

### The bootstrap directory

`bootstrap/app.ts` creates the application, boots providers, registers middleware groups, and loads routes. `bootstrap/middleware.ts` names the `web` and `api` groups. `bootstrap/providers.ts` registers your service providers.

### The config directory

`config` contains `app.ts`, `auth.ts`, `cors.ts`, `database.ts`, `logging.ts`, and `session.ts` in the web starters (the API starter has no `session.ts`). Read them once so you know which environment variables they expect. See [configuration](/docs/1.x/configuration).

### The database directory

`database/migrations` holds schema changes. `database/factories` holds model factories, and `database/seeders/DatabaseSeeder.ts` is what `bunyad db:seed` runs. A SQLite file, when you use one, also lives under `database/`.

### The public directory

`public` is served as static files. `bun run build` (and `bun run dev`) writes the compiled stylesheet and, for React, Vue, and Svelte, the JavaScript bundle to `public/build`. The directory is generated; git ignores `public/build`.

### The resources directory

`resources/views` contains `.view` templates. Layouts, pages, components, and partials are files in that tree. The welcome page is `resources/views/welcome.view`; the Live starter keeps its component views in `resources/views/live`.

`resources/css/app.css` is the Tailwind and DaisyUI entry point. React, Vue, and Svelte starters also have `resources/js`: `app.tsx` / `app.ts`, `pages` (one file per page, found automatically), `layouts`, and `components`. There, `resources/views/app.view` is only the root template Inertia fills in.

### The routes directory

`routes/web.ts` defines the web interface. Those routes sit in the `web` middleware group, which starts the session and checks the CSRF token. The starter kits split auth and settings into `routes/auth.ts` and `routes/settings.ts`, called from `web.ts`.

`routes/api.ts`, in the API starter, defines stateless endpoints under `/api`. Requests there are authenticated with tokens when you add that middleware. They do not receive the session.

`routes/console.ts` is where you register scheduled tasks. It is not an HTTP route file. `bunyad route:list` reads `web.ts` and `api.ts` only.

### The storage directory

`storage` holds files the framework generates at runtime. `storage/framework/down` is the maintenance-mode marker described in [configuration](/docs/1.x/configuration). Logs and file caches belong under `storage` rather than next to your source.

### The scripts directory

`scripts/dev.ts` runs the server and the asset watchers for `bun run dev`. React, Vue, and Svelte starters add `scripts/build.ts`, which bundles `resources/js` with Bun.

### The tests directory

`tests` contains `bun test` files. The starter kits test sign-up, login, password reset, email verification, two-factor authentication, and settings through their routes (`tests/client.ts` holds the shared helpers). Run them with:

```shell
bun test
```

### server.ts

`server.ts` is the process entry. It calls `createApplication()` and then `serve`. There is no separate public front controller. Bun accepts the connection and the kernel handles it.

## The app directory

A new app contains `Http`, `Models`, and `Providers`. The Live starter adds `Live` (page components) and `Support`, and React, Vue, and Svelte starters add `Http/Middleware/HandleInertiaRequests.ts`. Other directories appear when you generate a class.

`app/Http` is the HTTP edge: controllers and form requests. `app/Providers` bootstraps services for this app. `AppServiceProvider` is empty on purpose. Put bindings there, or add another provider and register it from `bootstrap/providers.ts`.

Generate a class with `bunyad make:*` instead of copying a file by hand. The commands that exist today:

| Command | Creates |
| --- | --- |
| `make:controller` | `app/Http/Controllers` |
| `make:request` | `app/Http/Requests` |
| `make:middleware` | `app/Http/Middleware` |
| `make:model` | `app/Models` |
| `make:policy` | `app/Policies` |
| `make:event` | `app/Events` |
| `make:listener` | `app/Listeners` |
| `make:job` | `app/Jobs` |
| `make:mailable` | `app/Mail` |
| `make:notification` | `app/Notifications` |
| `make:resource` | `app/Http/Resources` |
| `make:command` | `app/Console/Commands` |
| `make:migration` | `database/migrations` |
| `make:factory` | `database/factories` |
| `make:seeder` | `database/seeders` |

### The Http directory

Controllers, middleware, and form requests live under `app/Http`. This is the code that runs because an HTTP request arrived. Domain rules that do not care about HTTP should not be trapped in a controller method.

### The Models directory

Each model class maps to a table. You query, insert, and update through the model. The starter kits include `app/Models/User.ts`; `config/auth.ts` names it as the user model.

### The Providers directory

Service providers bind services into the container and perform other boot work. `AppServiceProvider` is the one the starter ships. Add another provider when one class is doing too much.

### The Console directory

Console commands generated with `make:command` live in `app/Console/Commands`. The directory is created when you generate the first command.
