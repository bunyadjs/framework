# Upgrading

Every breaking change in a beta (or later) release is listed here with what to change. Patch releases never need steps. Newest first.

## How to use this page

1. Find your current version and read every section above it up to the version you are moving to.
2. Upgrade all `@bunyad/*` packages together, because they share one version: `bun add @bunyad/framework@beta` (or the individual packages you use).
3. Run `bun run typecheck` and your tests. Removed or renamed exports show up as type errors.

## Unreleased: route folders

Routes now live in folders, and the app is `routes/` + `app/` + `server.ts`. `bunyad route:list`, `compile`, `optimize` and `view:cache` read the folders under `routes/` only.

### The layout

| Before | Now |
| --- | --- |
| `src/` route folders | `routes/` |
| `src/Models`, `src/Http/Middleware`, `src/Providers`, … | `app/Models`, `app/Http/Middleware`, `app/Providers`, … |
| `@/*` → `src/*` | `@/*` → `app/*` |
| `bootstrap/app.ts`, `middleware.ts`, `providers.ts` | `server.ts` with `bunyad(import.meta, { groups, providers, middleware })` |
| `routes/console.ts` | `app/Console/schedule.ts` |
| `resources/views`, `resources/js`, `resources/css` | views and pages beside their controllers in `routes/`, `routes/app.css` |
| `tests/` | `_tests/` folders beside the code |
| the `./bunyad` wrapper and `scripts/dev.ts`, `scripts/build.ts` | the `bunyad` binary: `bunyad dev`, `bunyad build` |

`Application.path()` now always resolves under `app`, the `src` fallbacks are gone, and `createMiddlewarePlugin` / `createProvidersPlugin` were removed from `@bunyad/compiler` (the middleware and providers are in `server.ts`). Models are found in `app/Models`, so a model in another folder is no longer discovered by the CLI.

### Move routes into folders

1. Create `routes/`. A route tree is the web interface (the `web` middleware group) unless a root `app.routes.ts` says otherwise. For stateless endpoints put `export default { prefix: "api", use: ["api"] }` in an `api.routes.ts`. An app with both puts each in a group folder (`routes/(web)`, `routes/(api)`).
2. For each controller, make a folder named for its URL and move the controller into it. Move its form request next to it and import it as `./LoginRequest.ts`.
3. Where the folder conventions fit (see [Route Folders](../apps/docs-site/content/1.x/file-routing.md)), delete the route. Otherwise put the routes in a `route.ts` in that folder, with URIs relative to the folder.
4. Say who may open what in `<area>.routes.ts` (`access: "guest"`, `rules: { auth: [...] }`), or with `(group)` folders and `middleware.ts` files.
5. Replace `bootstrap/` with a `server.ts`:

```ts
import { bunyad } from "@bunyad/framework";

export const createApplication = bunyad(import.meta, {
  groups: { web: [startSession(), handleUrl(), verifyCsrf()] },
  providers: [AppServiceProvider],
});
```

### Pages next to controllers

Move each page from `resources/js/pages/<area>/<name>.tsx` (or `.vue`, `.svelte`) or `resources/views/<area>/<name>.view` into the route folder of its controller and name it for the page: `LoginPage.tsx`, `LoginPage.view`. Then:

1. Return the props from the action instead of calling `Inertia.render("…", props)` or `view("…", data)`; the view beside the controller is rendered for you. An action with no props returns nothing.
2. Layouts are `*Layout` files in a folder and wrap its pages and the folders below (`MainLayout.tsx` at the root). A page sets what its layouts show with `export const meta = { title: "…" }` (`@meta({ … })` in a `.view`). Layouts take `meta` and `children`.
3. Import shared code with `~/` (`"~/*": ["routes/*", ".bunyad/*"]` in `tsconfig.json`; React also needs `"jsx": "react-jsx"`). Shared components go in `routes/_components`.
4. Page names change from `auth/login` to `(auth)/login/LoginPage`. Update tests that check the page component, and run `bunyad types:generate`.
5. Live components in a route folder (`LoginLive.ts`) replace `Live.route()`; the package is now `@bunyad/live-components`.

### Rename `__invoke` to `handle`

Single-action controllers (`Route.get("/x", Controller)`) now call `handle()`. Rename the method.

### Route names

If you copied a starter, rename these in pages, views and tests (`bun run typecheck` finds them in typed frontends after `bunyad types:generate`): `password.request` → `forgot-password`, `password.email` → `forgot-password.store`, `two-factor.login` → `two-factor-challenge`, `two-factor.login.store` → `two-factor-challenge.store`, `verification.notice` → `email.verify`, `verification.send` → `email.verification-notification.store`, `password.confirm` → `confirm-password`, `password.confirm.store` → `confirm-password.store`, `profile.edit` → `settings.profile`, `profile.update` → `settings.profile.update`, `profile.destroy` → `settings.profile.destroy`, `password.edit` → `settings.password`, `password.update` → `settings.password.update`. The names `verification.verify`, `password.reset` and `two-factor.show` are unchanged. (`password.confirm` stays the name of the middleware.)

## From 0.2.0-beta.1 to 0.2.0-beta.2

No names were removed from the public API. Check these behaviour changes:

### Strict relation and column names

Relation and column names are now checked by the types. If `bun run typecheck` reports unknown names in `with()`, `where()` and similar calls, fix the name, or opt out for the whole app:

```ts
declare module "@bunyad/orm" {
  interface OrmTypeOptions {
    strictNames: false;
  }
}
```

### Model events

Events now fire in a fixed order (`saving`, `creating`, `created`, `saved` on create), `updated` fires only when something was written, and `updated_at` only changes when the model is dirty. If a test asserts on the order of events or on `updated_at` after saving an unchanged model, update it.

### Global scopes in relation queries

Global scopes of the related model now apply in `whereHas`, relation aggregates and many-to-many eager loads, and relation aggregates skip soft-deleted rows. Use `withoutGlobalScopes()` on the constraint if you relied on the old, wider result. A relation aggregate on an unknown relation name now throws.

### New package

`@bunyad/permissions` (roles, permissions, teams and tenants) is new and optional. `@bunyad/framework` registers its provider only when `config/permissions.ts` exists, so apps that do not use it are unaffected.

## From 0.2.0-beta.0 to 0.2.0-beta.1

No names were removed from the public API. Check these three behaviour changes:

### Rate limiter

Limits now use a sliding window. If you assert on exact `Retry-After` values or on the 429 body in tests, expect a slightly longer wait (about 72 seconds after exhausting a 5-per-minute limit) and a `retry_after` field in the default JSON body. Blocked attempts no longer count against the limit.

### `cursor()`

`cursor()` now streams one query instead of paging with `LIMIT`/`OFFSET`. Code that iterates it is unaffected. If you relied on it paging (for example, changing rows while iterating), use `lazy()` or `lazyById()`, which still chunk.

### Dates in the Bun SQL driver

`Date` bindings are now sent as datetime text. If you worked around the old serialization, you can remove the workaround.

### New packages

`@bunyad/debugbar` (a development debug bar) and `@bunyad/mcp` (one MCP server per app, started with `bunyad mcp`) are new and optional. The debug bar is off in production and in tests.

## From 0.1.0-alpha.0 to 0.2.0-beta.0

### Upgrade Bun

Bunyad needs Bun 1.4.0 or newer. Run `bun upgrade`.

### `@bunyad/metrics` routes and Redis prefix

- Links to `/pulse` and `/pulse/aggregates` become `/metrics` and `/metrics/aggregates`.
- Route names `pulse.dashboard` and `pulse.aggregates` become `metrics.dashboard` and `metrics.aggregates`.
- If you use `RedisMetricsStore` or `RedisMetricsIngest` with the default prefix, existing keys under `bunyad:pulse:` are no longer read. Pass `prefix: "bunyad:pulse:"` to keep them, or let them expire.
- The default ignore pattern for the recorder changed from `/^\/pulse/` to `/^\/metrics/`.

### Feature flags config

Rename `config/pennant.ts` to `config/features.ts`, and the environment variable `PENNANT_STORE` to `FEATURES_STORE`.

### SQL Server

If you use SQL Server, add `mssql` to your own dependencies. It is no longer installed with `@bunyad/database`.

### Console

A console line that is just `await something()` now prints the result. Scripts that relied on it printing nothing need no change beyond that.

### Local filesystem disks

A disk whose root contains a symlink that points outside the root now throws a "Path traversal detected" error when a path goes through that link. Move the data inside the root, or make the link's target the root itself.

### Checksums

`disk.checksum(path, algorithm)` throws "Unsupported checksum algorithm" for names Node does not know. It used to return an md5 digest for anything except `sha1` and `sha256`. Check any call that passes another algorithm name.

### Search driver

If you set `SEARCH_DRIVER` and also relied on it being ignored, unset it. It now selects the driver when `Search.configure({ driver })` was not called.

## Template for future releases

Copy this block above the previous release and fill it in.

```md
## From X.Y.Z to X.Y+1.0

### What changed (one heading per breaking change)

What used to happen, what happens now, and the exact change to make. Include a before and after code sample when the fix is not obvious.
```
