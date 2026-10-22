---
title: Directory Structure
description: The folders in a Bunyad application and what each one is for.
---

# Directory Structure

## Introduction

The starter kits are a starting point for a small application and a large one. The folders below are shared by all of them; the kits differ where noted. A folder in `routes` is a URL, and everything else has a fixed home, so you can find a file by what it does.

## The root directory

```text
my-app/
  app/
  config/
  database/
  public/
  routes/
  storage/
  server.ts
```

### The routes directory

`routes` holds everything that has a URL, and the files that belong to it. Each folder is a URL: its controller, form request, view and tests sit together (see [route folders](/docs/1.x/file-routing)). A folder in parentheses (`(auth)`) groups pages without adding a URL segment. Folders that start with `_` (`_components`, `_tests`) and folders that start with a capital letter are never URLs.

```text
routes/
  (auth)/
    login/
      LoginController.ts
      LoginRequest.ts
      LoginPage.tsx
    AuthLayout.tsx
    auth.routes.ts
  (app)/
    dashboard/DashboardPage.tsx
  MainLayout.tsx
  WelcomePage.tsx
  app.css
```

A `*Layout` file wraps every page in its folder and below. `auth.routes.ts` and `app.routes.ts` say who may open what. Tests live in `_tests/` folders beside the code they cover. The views are `.tsx`, `.vue`, `.svelte` or `.view` files named after the page (`LoginPage.view`), and `routes/app.css` is the Tailwind and DaisyUI entry point.

### The app directory

`app` holds the code that has no URL. Import from it with the `@/` alias (`@/*` → `app/*` in the app `tsconfig.json`):

```ts
import User from "@/Models/User.ts";
```

A new app contains `Models` and, for the Inertia kits, `Http/Middleware/HandleInertiaRequests.ts` and `Http/inertia-ssr.tsx`. The Live starter adds `Support`. Other directories appear when you generate a class:

| Command | Creates |
| --- | --- |
| `make:controller` | a route folder: `Auth/Register` is `routes/auth/register/RegisterController.ts` |
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
| `make:provider` | `app/Providers`, and adds it to `server.ts` |
| `make:migration` | `database/migrations` |
| `make:factory` | `database/factories` |
| `make:seeder` | `database/seeders` |

Scheduled tasks and console commands are registered in `app/Console/schedule.ts`. It is not an HTTP route file.

`app/Models` holds the model classes; `config/auth.ts` names `User` as the user model. `app/Providers` bootstraps services: add a provider when one class is doing too much, and list it in `server.ts`.

### The config directory

`config` contains `app.ts`, `auth.ts`, `cors.ts`, `database.ts`, `logging.ts`, and `session.ts` in the web starters (the API starter has no `session.ts`). Read them once so you know which environment variables they expect. See [configuration](/docs/1.x/configuration).

### The database directory

`database/migrations` holds schema changes. `database/factories` holds model factories, and `database/seeders/DatabaseSeeder.ts` is what `bunyad db:seed` runs. A SQLite file, when you use one, also lives under `database/`.

### The public directory

`public` is served as static files. `bun run build` (and `bun run dev`) writes the compiled stylesheet and, for React, Vue, and Svelte, the JavaScript bundle to `public/build`. The directory is generated; git ignores `public/build`.

### The storage directory

`storage` holds files the framework generates at runtime. `storage/framework/down` is the maintenance-mode marker described in [configuration](/docs/1.x/configuration). Logs and file caches belong under `storage` rather than next to your source.

### The .bunyad directory

React, Vue, and Svelte apps also get `.bunyad`, written by `bunyad types:generate`: the typed `route()` helper, the shared-props types, and the page declarations. It is generated and never edited.

### server.ts

`server.ts` boots the application and serves it when it is the entry:

```ts
import { bunyad } from "@bunyad/framework";

export const createApplication = bunyad(import.meta);
```

`bunyad()` finds `config/` and `routes/` next to it and boots the framework. Pass `groups` for the `web` and `api` middleware groups, `providers` for your own service providers, and `middleware` for global middleware. Tests and the CLI import `createApplication`.

There is no `bootstrap` directory and no separate public front controller. Bun accepts the connection and the kernel handles it.

## The tests

Tests sit in `_tests/` folders beside the routes they cover (`routes/(auth)/_tests/auth.test.ts`); the starter kits test sign-up, login, password reset, email verification, two-factor authentication, and settings through their routes, with a shared helper in `app/Testing/client.ts`. Run them with:

```shell
bun test
```
