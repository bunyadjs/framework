---
title: Installation
description: Install Bun, pick a starter kit, and start the development server.
---

# Installation

## Meet Bunyad

Bunyad runs on Bun. The starter copies a working application into a new directory. You install its packages and start the HTTP server.

Every web starter ships the same features: sign up, log in with remember me, two-factor authentication, password reset, email verification, password confirmation, a sidebar dashboard, and settings for profile, password, two-factor, appearance, and account deletion. They share one stylesheet, DaisyUI on Tailwind. What differs is how pages are built:

| Starter | Pages |
| --- | --- |
| `views` | Server-rendered `.view` templates and controllers |
| `live` | `.view` templates driven by [Live](/docs/1.x/live) components; forms and links update without full page loads |
| `react` | React on [Inertia](/docs/1.x/inertia); controllers stay on the server |
| `vue` | Vue on Inertia |
| `svelte` | Svelte 5 on Inertia |
| `api` | No pages: JSON with bearer tokens and rate limits |

The `saas` template adds billing, queued mail, and an admin area on top of a web app. Pick the starter that matches how you want to write pages. You can add packages later.

## Creating an application

### Install Bun

Install Bun, then open a new terminal so `bun` is on your path.

:::tabs
```shell title="macOS"
curl -fsSL https://bun.sh/install | bash
```
```shell title="Windows"
powershell -c "irm bun.sh/install.ps1 | iex"
```
```shell title="Linux"
curl -fsSL https://bun.sh/install | bash
```
:::

Confirm the install:

```shell
bun --version
```

### Create the project

```shell
bun create bunyad my-app
cd my-app
bun run dev
```

`bun create bunyad` asks which starter kit to use (Views, Live, React, Vue, Svelte, or API), which database (SQLite, PostgreSQL, or MySQL), whether to install the packages now, and whether to start a git repository. It copies the kit without build output or local databases, copies `.env.example` to `.env`, sets `APP_KEY`, and prints the next commands.

Skip the questions with options:

```shell
bun create bunyad my-app --kit=react --database=pgsql --install --git
```

| Option | Meaning |
| --- | --- |
| `--kit=<name>` | `views`, `live`, `react`, `vue`, `svelte`, `api`, or `saas` (the billing add-on is not in the menu) |
| `--database=<name>` | `sqlite` (default), `pgsql`, or `mysql` |
| `--install` / `--no-install` | Run `bun install` in the new app |
| `--git` / `--no-git` | Run `git init` in the new app |

To use the `bunyad` command anywhere, install the CLI globally with `bun add -g @bunyad/cli`. `bunyad new` then asks the same questions. Inside an app, `bunyad` runs the app's own copy of the framework.

If you are working from a checkout of the Bunyad repository, `bun run bunyad new views my-app` does the same.

The development server listens on [http://localhost:3000](http://localhost:3000) unless `PORT` is set.


`bun run dev` starts the server with hot reload (`bunyad serve --hot`) and the asset watchers side by side: Tailwind for every web starter, plus the frontend bundle for React, Vue, and Svelte. Each output line is prefixed with the process it came from. The server loads `server.ts`:

```ts title="server.ts"
import { serve } from "@bunyad/core";
import { createApplication } from "./bootstrap/app.ts";

const app = await createApplication();
serve(app);
```

Stop everything with `Ctrl+C`. `bun run build` builds the assets once for production.

## Initial configuration

### Environment based configuration

The starter reads the environment when it boots. Create a `.env` file next to `package.json` when a machine needs its own values:

```env
APP_NAME="Bunyad"
APP_ENV=local
APP_DEBUG=true
APP_URL=http://localhost:3000
PORT=3000
```

`APP_DEBUG` controls how much of an error is shown to the client. It does not follow `APP_ENV`. Set `APP_DEBUG=false` on any machine that should not show source code. The [configuration](/docs/1.x/configuration) and [error handling](/docs/1.x/errors) pages go into detail.

### Databases and migrations

Every starter ships `config/database.ts` and migrations under `database/migrations` (users, password reset tokens, and two-factor columns). Point `DB_CONNECTION` at the database you want. SQLite is the default used by the CLI when `DB_CONNECTION` is unset: the file is `database/database.sqlite`.

Run the migrations after the database exists:

```shell
bunyad migrate
```

### Directory configuration

`bootstrap/app.ts` is the file that creates the application, registers middleware, and loads `routes/web.ts`. You rarely change the path of that file. When you add another route file, load it from the same function with `loadRouteModule`. The [directory structure](/docs/1.x/structure) page lists every folder the starter creates.

## Next steps

### The full stack application

After `bun run dev`, open `/` for the welcome page, then `/register` and `/login`. Routes live in `routes/web.ts`, `routes/auth.ts`, and `routes/settings.ts`. In the `views`, `react`, `vue`, and `svelte` starters, controllers live in `app/Http/Controllers`; in `live`, pages are components in `app/Live`. React, Vue, and Svelte pages live in `resources/js/pages`.

Password reset and verification links go out as mail; `.env.example` sets `MAIL_MAILER=log` for local work. Email verification is off until the `User` model takes `@MustVerifyEmail()`. See [email verification](/docs/1.x/verification) and [two-factor authentication](/docs/1.x/two-factor).

### The API

Create the API starter when the client is another program. It serves JSON with bearer tokens. It does not start a session or render views. Mail, file storage, queues, notifications, broadcasting, and dump stay available.

```shell
bun run bunyad new api my-api
cd my-api
bun install
bun run dev
```

Routes live in `routes/api.ts`. They get the `api` middleware group and the `/api` prefix automatically, and no session middleware. [Routing](/docs/1.x/routing) shows the group.
