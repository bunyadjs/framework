---
title: The Compiler
description: Turn routes, views, and config into a .build directory you can start in production.
---

# The Compiler

## Introduction

`bunyad compile` reads your application and writes a `.build` directory. The compiled server, the route table, the view functions, and the config imports live in that directory. Production starts from those files instead of scanning `routes/`, `config/`, and `resources/views` on every boot.

Development does not need a compile step. `bunyad serve` loads your source. Compile when you deploy, or when you want a single binary.

```shell
bunyad compile
bunyad start
```

`compile` exits with an error if neither `routes/web.ts` nor `routes/api.ts` exists. Those two files are the route entries it loads. `routes/console.ts` is included when it exists, for the schedule worker.

## What compile writes

The command prints a route count, a view count when you have templates, and the HTTP entry. These files are always written:

| File | Role |
| --- | --- |
| `manifest.json` | Version, timestamp, and the entry map (`http`, `queue`, `scheduler`, `app`). |
| `server.ts` | HTTP entry. `bunyad start` loads this by default. |
| `routes.ts` | `createCompiledRouter()`, the route table as code. |
| `queue-worker.ts` | Queue entry. |
| `schedule-worker.ts` | Scheduler entry. |
| `standalone.ts` | One process that can run HTTP, the queue, or the scheduler. |

These are written only when the matching source exists:

| File | Written when |
| --- | --- |
| `views/` | `resources/views` contains `.view` files. Includes `views/index.js`. |
| `config.ts` | `config/` contains `.ts` or `.js` modules. |
| `providers.ts` | `bootstrap/providers.ts` exists. |
| `middleware.ts` | `bootstrap/middleware.ts` exists. |
| `discovery.ts` | A policy, mailable, view component, Live component, user model, or token model was found. |
| `migrations.js` | The migrations directory contains migrations. |

### Which routes compile

`routes.ts` registers each route again as code, so every action has to be importable:

- **Controller actions** (`[UserController, "show"]`) compile, with their argument plan written out, even when the method takes nothing. A production boot never reads controller source to work it out.
- **Helper routes** compile too: `Route.view(uri, name, data)`, `Route.redirect(from, to)`, `Inertia.route(uri, component, props)`, and `Live.route(uri, component)`. Each helper records what it does, and the compiled route calls the same thing (`router.view(…)`, `inertiaPage(…)`, `livePage(…)`). Their data (view data, page props) must be plain JSON.
- **Closures** (`Route.get("/", () => …)`) and helpers given functions (a render callback, a function prop) are skipped with a `BUNYAD_ROUTE_010` warning; move them to a controller.

`bootstrap/app.ts` receives the compiled router from `.build/server.ts` (`createApplication({ router })`) and then does not load `routes/*.ts` again. An app without `resources/views` compiles without a views index, and its entry does not import `@bunyad/view`.

`.build/manifest.json` is the signal that a production boot should use these files. That happens when `BUNYAD_COMPILED=1`, or when `NODE_ENV` is `production` and the manifest is present. `BUNYAD_DEV=1` or `BUNYAD_HOT=1` keeps the source scan even if `.build` exists, so a local server does not silently switch to the last compile.

## Route matching

Compiled routes use a radix tree. Matching walks the tree instead of testing every route. Pass `--no-optimize` when you need the linear matcher while you are debugging a route:

```shell
bunyad compile --no-optimize
```

The compiled router is what `bunyad start` serves. `route:cache` is a separate listing. It writes `.build/routes.json` (method, URI, name, action) and does not change the running server. `route:clear` deletes that file.

```shell
bunyad route:cache
bunyad route:clear
```

A duplicate method and URI fails the compile. The message names the route and the file:

```text
BUNYAD_ROUTE_002: Duplicate route [GET /users/{user}].
  --> /app/routes/web.ts
```

The path is the route entry that was compiled. Fix the route file and compile again. Warnings are printed and do not stop the build. Errors do.

## Views

Every `resources/views/**/*.view` file becomes a function under `.build/views`. `resources/views/users/show.view` is the view name `users.show` and the file `.build/views/users/show.js`. `views/index.js` maps those names to the functions.

The template syntax is on the [views](/docs/1.x/views) page. A compiled app renders from these functions. It does not read the `.view` files again unless you are in development.

There is no separate command that compiles views on their own. They are part of `bunyad compile`.

## Configuration

`compile` writes `.build/config.ts`. That module imports each `config/*.ts` and `config/*.js` file (`.d.ts` files are skipped) and exposes `applyCompiledConfig`. Compiled boot calls it instead of reading the `config` directory.

`config:cache` is the JSON snapshot. It imports those same files once and writes the result to `.build/config.json`. `config:clear` deletes the snapshot.

```shell
bunyad config:cache
bunyad config:clear
```

When both files exist, compiled boot uses `config.ts`. The JSON file is the fallback when `config.ts` is missing. Because `config.ts` imports your modules, `env()` inside a config file still runs when the process starts.

Keep `env()` in config files. Application code should read `config("app.name")`, not `env("APP_NAME")`.

## Running the compiled app

`bunyad start` loads the `http` entry from the manifest, which is `.build/server.ts`. It sets `NODE_ENV` to `production` when you have not set it.

```shell
bunyad start
bunyad start --entry=queue
bunyad start --entry=scheduler
bunyad start --workers=4
```

`--entry` selects `http`, `queue`, or `scheduler`. An unknown name prints the entries from the manifest and exits. `--workers` starts that many HTTP processes sharing the port. It does not start a queue worker. Use `bunyad workers` when you want HTTP, queue, and the scheduler under one supervisor:

```shell
bunyad workers --http=2 --queue=1 --schedule
```

`--queue-name` selects the queue. `--no-restart` leaves a crashed process down. `--max-restarts` and `--shutdown-timeout` bound restarts and the time a worker gets to finish.

## Binaries

`--binary` compiles `.build`, then writes a standalone executable with `Bun.build`. The default output is `.build/bin/bunyad`, one file that runs HTTP, the queue, or the scheduler:

```shell
bunyad compile --binary
.build/bin/bunyad http
```

The binary embeds `public/` and the compiled views and migrations. SQLite files and `storage/` stay on disk, relative to the working directory, unless you set `BUNYAD_BASE_PATH` or `DATABASE_PATH`.

Image processing (`sharp`) is stubbed. Calling it throws. SQL Server (`mssql`) is stubbed unless you pass `--with-sqlsrv`. Inline Inertia server rendering is stubbed unless you pass `--with-inertia-ssr`. For Inertia, the other option is `INERTIA_SSR_MODE=http` and a separate SSR process.

```shell
bunyad compile --binary --with-sqlsrv --with-inertia-ssr
```

## Programmatic API

The CLI is the path you want in a deploy script. `compile` from `@bunyad/compiler` is the same pipeline, for a script that needs a custom view directory or extra route files:

```ts
import { resolve } from "node:path";
import { compile } from "@bunyad/compiler";
import { createViewPlugin } from "@bunyad/view";

const root = process.cwd();

const manifest = await compile({
  root,
  optimize: true,
  routesEntries: [resolve(root, "routes/web.ts")],
  plugins: [createViewPlugin()],
  bootstrap: {
    applicationModule: resolve(root, "bootstrap/app.ts"),
  },
});

manifest.entries.http;
```

`optimize: true` emits the radix matcher. `plugins` is required. Pass `createViewPlugin()` or the view files are not compiled. `routesEntries` is the list of route modules. The CLI fills that list from `routes/web.ts` and `routes/api.ts` when those files exist.
