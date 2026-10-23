---
title: Choosing a Structure
description: Folders or classic: how the two layouts differ, which one fits your app, and how the framework and the CLI follow your choice.
---

# Choosing a Structure

## Introduction

A Bunyad app can be laid out in two ways. Both are complete: the framework, the command line and every starter kit support them.

`bunyad new` asks which one you want:

```bash
bunyad new react my-app                       # asks
bunyad new react my-app --structure=folders
bunyad new react my-app --structure=classic
```

The choice is written to `bunyad.json` (`{ "structure": "classic" }`). An app without that file is told apart by its files: a `routes/web.ts` or an `app/Http/Controllers` folder means classic, a route folder with controllers means folders.

## Folders

A folder is a URL. The controller, the page, the form request and the tests for a screen sit together:

```text
routes/
  (auth)/
    login/
      LoginController.ts
      LoginPage.tsx
      LoginRequest.ts
  (app)/
    settings/
      profile/
        ProfileController.ts
        ProfilePage.tsx
```

There is no route file to keep in step: the folder names are the URLs. See [route folders](/docs/1.x/file-routing).

Choose folders when you start a new app, when you work on one screen at a time, or when you want to find everything for a URL in one place.

## Classic

Code is grouped by kind, and every URL is written by hand:

```text
app/Http/Controllers/Auth/LoginController.ts
app/Http/Requests/Auth/LoginRequest.ts
resources/js/pages/auth/login.tsx        (or resources/views/auth/login.view)
routes/web.ts
routes/api.ts
```

```ts
// routes/web.ts
Route.get("/login", [LoginController, "create"]).name("login");
```

`routes/web.ts` and `routes/api.ts` are loaded for you; `api.ts` gets the `api` middleware group and the `/api` prefix. A controller renders a page by its path: `Inertia.render("auth/login")`.

Choose classic when your team already works this way, when you are moving an existing app to Bunyad, or when you want one file that lists every URL.

## At a glance

| | Folders | Classic |
|---|---|---|
| Controllers | `routes/<url>/XController.ts` | `app/Http/Controllers/` |
| Form requests | beside the controller | `app/Http/Requests/` |
| Routes | the folder names, plus `*.routes.ts` | `routes/web.ts`, `routes/api.ts` |
| Pages | `XPage.tsx` / `.vue` / `.svelte` / `.view` beside the controller | `resources/js/pages/`, `resources/views/` |
| Layouts | `XLayout.*` in the folder it wraps | `resources/js/layouts/` |
| Tests | `_tests/` beside the code | `tests/` |

## The command line follows your choice

`make:controller` and `make:request` write where your app keeps them, whichever folder of the app you run them from:

```bash
bunyad make:controller Auth/Register     # folders: routes/auth/register/RegisterController.ts
                                         # classic: app/Http/Controllers/Auth/RegisterController.ts
```

In folders, run from inside `routes/(auth)`, `Login` gives `routes/(auth)/login/LoginController.ts`, and `--requests` puts the form requests beside the controller. In classic, the command prints the `Route.get(...)` line to add to `routes/web.ts`.

## Changing your mind

Pick one per app. `bunyad(import.meta)` loads the route folders when `routes/` has them, and `routes/web.ts` and `routes/api.ts` only when it has none, so an app does not run both. An app that boots through `Application.configure().withRouting(...)` chooses its route files itself and is not affected.

Moving a classic app to folders is done by hand for now: for each route, create the folder, move its controller and page in, and delete the line from `routes/web.ts`.
