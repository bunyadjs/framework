# Changelog

All `@bunyad/*` packages and `create-bunyad` share one version number and are released together. See [docs/STABILITY.md](docs/STABILITY.md) for what each stage promises and [docs/UPGRADING.md](docs/UPGRADING.md) for how to move between releases.

## 0.2.0-beta.3

Published under the `beta` npm tag. Routes can now live in folders, and `bunyad new` offers a classic layout as well. Several starter names changed; the steps are in [docs/UPGRADING.md](docs/UPGRADING.md).

### Added

- **Two structures, your choice.** `bunyad new` asks "Which structure?" (Folders, recommended, or Classic) with a line on when each fits, or takes `--structure=folders|classic`. Classic keeps controllers in `app/Http/Controllers`, routes in `routes/web.ts` and `routes/api.ts`, and pages in `resources/js/pages`; the choice is written to `bunyad.json`. Every starter has both (`templates/<kit>-classic` is laid over the kit). `bunyad(import.meta)` loads `routes/web.ts` and `routes/api.ts` for an app with no route folders, `bunyad build` finds pages in `resources/js/pages`, and `make:controller` and `make:request` write for whichever structure the app uses (`bunyad.json`, else its files) and from any subfolder of the app. `@bunyad/router` exports `routeTreeOf`.
- **Route folders.** Routes live in folders under `routes/`: a folder is a URL, and its controller, form request and routes sit together. `routes/` is the route tree, and a `(group)` folder with its own `middleware.ts` is a surface; `middleware.ts` may also export a URL `prefix`. A folder with an `index` method or a `[param]` folder is a resource; any other folder is one page at the folder URL. `middleware.ts` applies to its folder and everything below it, `route.ts` holds routes the conventions cannot express, `(group)` folders add no URL segment and names starting with `_` are ignored. See the new [Route Folders](apps/docs-site/content/1.x/file-routing.md) page.
- **Views next to controllers.** A controller returns data, and the view file beside it (`LoginPage.tsx`, `ProductEditPage.vue`) renders it on GET; JSON requests and the other verbs get JSON, and a `Response` is sent as is. A folder's view is its GET page, so a controller needs no empty method for it, and a folder with a view and no controller is a page by itself. `@View("…")` points an action at another view file. The React, Vue and Svelte starters keep their pages in the route folders; `resources/js` holds only shared code (`components`, `layouts`, `routes.ts`, the entry file).
- **`@bunyad/router`:** `scanRoutes`, `collectFileRoutes`, `registerFileRoutes`, `routeEntries` and `controllerSourceFile`, `fullMiddleware`, `setPageResponder`, `pageResponderFor` and `pageName`. `loadRouteModule` accepts a route folder, and routes have a `page` (the compiled output keeps it).
- **`@bunyad/inertia`:** `registerInertiaPages()` (called by `InertiaServiceProvider`) renders view files ending in `.tsx`, `.jsx`, `.vue` and `.svelte` from the data an action returns.
- **`@bunyad/http`:** `@View("…")`, `@Name("…")` (route name, on a class or method), `@Method("POST")` (verb of a `handle` controller) and `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete` to give a controller method a route. `bunyad route:list` now includes middleware declared with `@Middleware` on the controller.

### Changed

- **Faster requests for apps that boot the framework providers.** CORS was global middleware that rebuilt its merged config and re-tested the path on every request, and its presence kept every route off the kernel's fast path. It now compiles its paths once, and global middleware may declare `appliesTo(route)` so the kernel leaves it out of routes it cannot affect (a non-API URL needs no CORS). In-process, a file-routed app went from about 289k to about 589k requests per second with all providers booted, the same as with none. Behavior is unchanged: a route whose URL could match a CORS path, including one with a `{param}` segment, still gets it, and preflight for unmatched URLs is still answered.
- **Breaking (folder layout): code stays in `app/`, URLs are in `routes/`.** Models, providers, middleware, jobs and the rest of an app's code live in `app/` (`@/` points at it), and the controller, page, form request and tests of a URL live in `routes/<url>/` (`make:controller Auth/Register` makes `routes/auth/register/RegisterController.ts`). A folder in `routes/` that starts with a capital letter or `_` is code and is never a URL. A route tree gets the `web` middleware group by default, so the web starters have no root `middleware.ts`.
- **The folder starters have no `routes/web.ts` or `routes/api.ts`.** They use route folders, and so do the sample app and the playground. `bunyad route:list`, `compile`, `optimize` and `view:cache` read the route folders, or `routes/web.ts` and `routes/api.ts` in a classic app.
- **Breaking: single-action controllers use `handle()`** instead of `__invoke()`.
- **Breaking: some starter route names follow their folders.** `password.request` is `forgot-password`, `password.email` is `forgot-password.store`, `two-factor.login` is `two-factor-challenge`, `two-factor.login.store` is `two-factor-challenge.store`, `verification.notice` is `email.verify`, `verification.send` is `email.verification-notification.store`, `password.confirm` and `password.confirm.store` are `confirm-password` and `confirm-password.store`, `profile.edit|update|destroy` are `settings.profile` and `settings.profile.update|destroy`, and `password.edit|update` are `settings.password` and `settings.password.update`. In the API starter, `api.me`, `api.register`, `api.token.store` and `api.token.destroy` are `me`, `register`, `token.store` and `token.destroy`.
- **Breaking (folder layout): the Inertia starters' pages moved.** `resources/js/pages/auth/login.tsx` is `routes/(auth)/login/LoginPage.tsx`, and page names are paths such as `(auth)/login/LoginPage`. Pages import shared code with `~/` (`routes/` and `.bunyad/`). `appearance.edit` is `settings.appearance`. `bunyad types:generate` reads pages from `routes/`. A classic app keeps `resources/js/pages` and names like `auth/login`.
- **Auth controllers sit beside their pages.** Each sign-in page has a small controller in its folder (`login/LoginController.ts`, `register/RegisterController.ts`) with its form request next to it (`LoginRequest.ts`). Actions with no page (logout, the resend button, the signed mail link) are in `(auth)/AuthController.ts`, and `(auth)/auth.routes.ts` says who may open what. Route decorators take `{ name, middleware }`.
- **`bunyad(import.meta)`** in `@bunyad/framework` boots an app in one line (`export const createApplication = bunyad(import.meta);`): it finds `config/` and `routes/`, boots the framework providers, and serves when the file is the entry. Options: `groups`, `providers`, `except`. The React, Vue, Svelte, Views, SaaS, Live and API starters use it. A hello world is two files and six lines (`docs/examples/hello-world`), and the competitor benchmark has a `bunyad-app` leg that runs a file-routed app next to Hono, Elysia and Fastify.
- **`.view` pages beside their controllers.** An app without `resources/views` finds its templates under `routes/`: `LoginPage.view` is the view of the `login/` folder, `*Layout.view` files wrap the pages in their folder and below (outermost first, printed with `{!! children !!}`), and `<x-…>` components load from `routes/_components`. A page sets what its layouts show with `@meta({ title: "…" })`, which layouts read as `meta`. `bunyad dev` and `bunyad build` run the server and Tailwind for such apps. The Views and SaaS starters use this.
- **Packages removed.** `@bunyad/agent` (a user-agent parser nothing used), `@bunyad/nestjs` (unpublished NestJS glue), and `@bunyad/migrate` (the PHP project scanner, with `bunyad migrate:report` and `migrate:convert`) are gone. `@bunyad/console` (the REPL behind `bunyad console`) is part of `@bunyad/cli` now.
- **Breaking: `@bunyad/live` is now `@bunyad/live-components`.** The package directory, imports and the API snapshot (`api/live-components.json`) moved; `Live` and `LiveComponent` keep their names.
- **A Live component is the page of its folder.** `routes/(auth)/login/LoginLive.ts` (a `LiveComponent`) with `LoginPage.view` beside it is served at `/login` inside the folder layouts, with no `Live.route()` call. Components register under their path in `routes/` (`(auth).login.LoginLive`), the `/live/update` endpoint and client script are added for you, and `static routeName` / `static meta` name the route and say what the layouts show. `compile` and the discovery output include them. The Live starter uses this.
- **Plain stylesheets.** `bunyad build` and `bunyad dev` copy `routes/app.css` to `public/build/app.css` when it does not import Tailwind, so an app with ordinary CSS needs no Tailwind install. `@push` / `@stack` work between a `.view` page and its layouts.
- **Error pages.** `NotFoundPage`, `ForbiddenPage`, `ExpiredPage` and `ErrorPage` at the root of `routes/` (`.tsx`, `.vue`, `.svelte` or `.view`) render for browser requests with `status` and `message` as props. The starters ship `NotFoundPage` and `ErrorPage`.
- **Permissions on routes.** `rules` in `<area>.routes.ts` take any middleware (`"can:update,post": "posts/**"`), `@Can(ability, ...models)` goes on a controller or action, `public` marks a route open, and `strict: true` on an area makes every route say who may open it.
- **Domains and tenants.** `domain: "admin.{root}"` or `["{tenant}.{root}", …]` in `<area>.routes.ts` limits an area to hosts, and `Domain.resolver()` maps database-registered custom domains to one of them (cached, `Domain.forget()`). The HTTP kernel now passes the request host to the router, so domain routes work, and `compile` keeps `domain`.
- **Translations.** `lang/<locale>.json` and `lang.<locale>.json` beside a page, read with `trans()` / `__()` (also in views) and `translations()` for a frontend.
- **Typed props for Vue and Svelte**, and `.bunyad/props.check.ts`, which checks what an action returns against the props of the page that renders it.
- **`<area>.routes.ts`** (`auth.routes.ts`, or `app.routes.ts` at the root) declares middleware, a prefix and access rules for its folder: `access: "guest"` makes a whole area guest-only, `rules: { auth: ["confirm-password"] }` lists the exceptions (`guest` and `auth` replace each other), and `{ access: "auth" }` works on a route decorator. `@Middleware` on a controller class also covers the pages under it. A rule that matches no route is a build error. It replaces `middleware.ts` and the group folders that only held one; `middleware.ts` still works. The React starter uses it.
- **A controller can serve the folders below it.** A folder with no controller of its own uses the nearest one above, and the method named after the folder answers its requests (`login()` for GET, `postLogin()` for POST); every method is optional, and a folder with only a page still renders. The route tree is `routes/`, with the code in `app/`. `bunyad dev` and `bunyad build` are built in for React apps, an app can boot from `server.ts` with no `bootstrap/` folder, generated types (routes, shared props, page props, `virtual:pages`) go in `.bunyad/`, and `InertiaServiceProvider` takes `ssr.entry`. The React starter uses this layout (a small controller per folder with plain names such as `store` and `show`; parent controllers stay available when several pages share one), with Next.js-style layouts (a `*Layout.tsx` wraps its folder and everything below, `MainLayout.tsx` at the root wraps all; a page exports `meta` for them), and has no `resources/` folder: shared UI is in `routes/_components` and `_hooks`, the stylesheet is `routes/app.css`, the generated route helper and shared types are in `.bunyad/`, and `bunyad build` supplies the browser entry (`routes/app.tsx` replaces it). The Inertia root page has a complete built-in default (head, stylesheet, script, SSR body), so an app needs no `app.view`.
- **Logout** is `AuthController@logout` in the folder starters (`LogoutController` in the classic Live starter); `AuthenticatedSessionController` no longer has `destroy`.
- Controller source files for typed parameters and constructor injection are found from the route folder, not by searching `app/Http/Controllers` for the class name.

### Fixed

- The Live starter's signed verification link now requires its signature and is throttled, as in the other starters.
- `bunyad types:generate` writes `virtual:pages` as a plain ambient module, so an app's own entry file can import it and type-check.
- **Built `@bunyad/notifications` and `@bunyad/cache` could not load part of themselves.** A lazy `require("./x.ts")` was left pointing at a `.ts` file that the published package does not contain, so `Notification.fake()`, anonymous notifications and tagged caches failed when installed from npm. The build now rewrites those paths.
- A single-action controller that still has `__invoke()` fails with a message that says it was renamed to `handle()`.

## 0.2.0-beta.2

Published under the `beta` npm tag. No names were removed from the recorded public API (`api/*.json`); it only gained names. Behaviour changes are listed under "Changed", and [docs/UPGRADING.md](docs/UPGRADING.md) says what to check.

### Added

- **`@bunyad/permissions`:** roles, permissions, teams and tenants. Roles and grants live in a scope (`*`, `tenant:7`, `team:42`) and apply in the scopes below it. A check is a bit test: a warm check runs no queries and a cold one runs one statement. Includes the `HasPermissions` model mixin, `permission:` / `permission.any:` / `role:` route middleware, a Gate hook so `Gate.allows('posts.update')` and `@can('posts.update')` in views work, `whereCan` / `whereHasRole` query conditions, `grantMany`, expiring grants, `copyRoles` for tenant onboarding, API tokens that can only narrow their owner, and `permissions:*` commands (`sync`, `warm`, `cache-clear`, `prune`, `rebuild`, `check-routes`, `doctor`). Publish the migration and config with `bunyad publish --tag=permissions-migrations` and `--tag=permissions-config`; table names are configurable. Cache version counters keep many servers in step without clearing anything, and a failing cache falls back to the database. Optional ways to skip the grants query: keep a user's grants in a column on the user row, or carry them as claims in a signed token. `@bunyad/framework` adds `PermissionServiceProvider` (off until `config/permissions.ts` exists) and re-exports the common names.
- **ORM relations:** `morphedByMany` with `attach`, `sync`, `toggle` and eager loading; `wherePivot` and `orderByPivot`; `withDefault`; per-parent eager-load limits; custom pivot models (`using`, `as`) and the pivot model events (`attach`, `detach`, `sync`, `toggle`, `updateExistingPivot`); `whereHas` and aggregates on `morphMany`, `morphOne` and `morphedByMany`; scoped lazy `morphToMany`; morph map controls, and an error for ambiguous morph class names; `chaperone`.
- **ORM writes:** many-to-many and morph pivot writes are batched and `sync` is diff-based (it keeps pivot data and returns `attached`, `detached` and `updated`); `updateExistingPivot` and `withTimestamps`; `Model.getPrevious()`; parameterized casts; `forceFill` and `unguard`; `only()`; a global `Model.withoutEvents`; `afterCommit` observers.
- **ORM queries:** subquery, union and sub-join methods on model queries; constraint closures in `withCount`, `withSum` and the other relation aggregates, which now also work on through and morph relations; `whereNot` accepts a column.
- **ORM tooling:** `strict()` for compile-time checked relation and column names, with editor suggestions; `schema:check` and `schema:types` (backed by `Schema.getColumns`); query-budget tests, and `find` and insert queries are now reported to query listeners; richer model factories (a shared `for()` parent, morph and pivot relationships, `createMany`, quiet creators, `recycle`).
- **Tests and docs:** scale tests on 100k rows, a bundle-size guard for the ORM, ORM micro-benchmarks, a documented tenant-scoping pattern with a global scope, and docs for value objects through `Attribute.make`.

### Changed

- **Relation and column names are strict in the types by default.** An unknown name in `with()`, `where()` and friends is now a type error. Opt out for the whole app with `strictNames: false` in `OrmTypeOptions`. Runtime behaviour is unchanged.
- **Model events fire in a fixed order.** Create: `saving`, `creating`, `created`, `saved`. Update: `saving`, `updating`, `updated`, `saved`. `created_at` and `updated_at` are set after `creating` / `updating`, and `updated` fires only when something was written.
- **`updated_at` only changes when the model is dirty.**
- **Related global scopes apply in `whereHas`, relation aggregates and many-to-many eager loads.** Relation aggregates skip soft-deleted rows, and a relation aggregate on an unknown relation name throws.

### Fixed

- Compiler stack overflow on circular models; relations declared as properties are recognised.
- SQLite inserts dropped attributes that were not fillable, and database defaults.
- MySQL affected-row counts and per-driver SQL caches.
- In-place edits of `json`, `array` and collection attributes are detected, and `saved` listeners see the save.
- `json` string round trips, decimal rounding and invalid date writes in casts.
- Paginator JSON data and `bigint` serialization.

## 0.2.0-beta.1

Published under the `beta` npm tag; `latest` still does not move until 1.0. No breaking API changes: the recorded public API (`api/*.json`) only gained names. Behaviour changes are listed under "Changed", and [docs/UPGRADING.md](docs/UPGRADING.md) says what to check.

### Added

- **`@bunyad/debugbar`:** a development debug bar with queries, timeline, request, logs, cache and exceptions tabs, retained request history, and a `/_debugbar` JSON API. Records scheduled tasks automatically and any work you wrap in `Debugbar.profile()` as their own history entries. Masks secrets and personal data (including SQL bindings, by column) before anything is stored or sent to an agent. Registers seven `debugbar_*` tools with `@bunyad/mcp` so an AI agent can inspect recorded requests, including two that analyse every recorded request (`debugbar_hot_queries`, `debugbar_routes`). Adds `listenLog()` to `@bunyad/log`, `listenException()` to `@bunyad/core`, `listenDispatched()` to `@bunyad/events`, `wrapScheduledRuns()` to `@bunyad/schedule`, and a `callSites` option on `listen()` in `@bunyad/database` (`listen(cb, { callSites: true })` adds the stack captured when each query was issued, so async drivers can report where a query came from).
- **`@bunyad/mcp`:** one MCP server per app. Packages register tools with `Mcp.tool()`; `bunyad mcp` boots the app and serves them to an AI agent over stdio. Includes argument validation, output caps and stdout protection.
- **Streaming reads:** `cursor()` on the query builder and the ORM now streams rows from a single query, through an optional `Connection.stream()` implemented per driver (a fallback to chunked paging where a driver has no primitive). New static `Model.cursor()`, `lazy()`, `lazyById()` and `lazyByIdDesc()`; `cursor()`, `lazy()` and `lazyById()` return a `LazyCollection`.

### Changed

- **`cursor()` really streams.** It used to be an alias of `lazy()`: one `LIMIT`/`OFFSET` query per chunk. It now runs one query and yields rows as they arrive. `lazy()` and `lazyById()` keep their chunked behaviour.
- **The rate limiter is a sliding window.** A client can no longer burst twice the limit across a window boundary. Blocked hits are no longer counted, so retrying does not extend a lockout. `availableIn()` and `availableAt()` accept the limit for an exact wait. The default 429 body now includes the wait, `{ "message": "Too Many Attempts. Please try again in 42 seconds.", "retry_after": 42 }`; custom `Limit.response()` factories are unchanged. After exhausting a 5-per-minute limit, `Retry-After` is about 72 seconds rather than 60 (the cost of the constant-time approximation).
- **`bunyad <command>` finds commands that providers register while the app boots** (`registerProviderCommand`, `ServiceProvider.commands()`). Before, it reported "Command ... is not defined".

### Fixed

- Plain column names in `select()` are quoted, so reserved words such as `order` no longer break the generated SQL.
- `Date` bindings are sent to the Bun SQL driver as datetime text in the format the driver expects.

## 0.2.0-beta.0

The first beta. Published under the `beta` npm tag; `latest` does not move until 1.0.

### Breaking changes (since `0.1.0-alpha.0`)

- **Bun 1.4.0 or newer** is required (`engines.bun >=1.4.0`). Older versions were never tested.
- **`@bunyad/metrics`:** the dashboard moved from `/pulse` to `/metrics`, route names from `pulse.*` to `metrics.*`, and the default Redis prefix from `bunyad:pulse:` to `bunyad:metrics:`.
- **Features:** the `pennant` config key and the `PENNANT_STORE` environment variable are gone. Use `features` and `FEATURES_STORE`.
- **`@bunyad/database`:** `mssql` is now an optional peer dependency. Install it yourself if you use SQL Server (still experimental).
- **`@bunyad/console`:** a line that is a single `await expr` now prints its value instead of nothing.
- **`@bunyad/filesystem`:** `LocalFilesystem` rejects paths that resolve outside the disk root through a symlink, and `checksum()` throws for an unknown algorithm instead of returning an md5 digest.
- **`@bunyad/search`:** `SEARCH_DRIVER` is now read when no driver is configured.

### Added

- Live PostgreSQL and MySQL test suites on Bun and Node 20, 22 and 24; a `tls` option on `connectMysql` (MySQL 8+ needs TLS for its default login).
- `bunyad --help`, `bunyad <command> --help`, app-name validation in `create-bunyad`, and a clear message when Bun is missing or too old.
- Real READMEs, with examples that were run, for every package.
- `docs/STABILITY.md`, `docs/UPGRADING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and a recorded public API (`api/*.json`) checked by a test.
- CI on every pull request: typecheck, tests with live databases, a Node matrix, a smoke test that scaffolds and runs each starter kit from packed tarballs, and a secret scan.
- `scripts/release.ts version` and a dist-tag derived from the version.

### Fixed

- **Security:** prototype pollution through `ConfigRepository.set` and `dataSet` (paths containing `__proto__`, `constructor` or `prototype` are ignored).
- **Security:** symlink escape from `LocalFilesystem`; filter injection in the Meilisearch engine; quote injection in the `Content-Disposition` header of `download()`.
- `@bunyad/database` failed to load on Node 20 (it imported `glob` from `node:fs/promises`, which is Node 22+).
- Typed factories (`Factory<T>`) could not be passed to `HasFactory`, `.for()` or `.has()`.
- `ValidateOptions.user`, `QueueRouteTarget`, `CacheStore.add`, inertia shared props and the search mixin had types that rejected valid use.
- `@bunyad/testing`: `freezeTime(new Date(...))` followed by `travel()` broke the clock, and singular units such as `"+1 hour"` were ignored.
- `@bunyad/log`: `parseLevel` accepted inherited object keys such as `"constructor"`.
- `@bunyad/console`: lines buffered after `.exit` were still evaluated.
- `canonical("http-guide")` was treated as an absolute URL.
- `create-bunyad` printed `bunyad migrate` (needs a global CLI); it now prints `bun ./bunyad migrate`.

## 0.1.0-alpha.0

First public release (alpha tag).
