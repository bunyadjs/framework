# Changelog

All `@bunyad/*` packages and `create-bunyad` share one version number and are released together. See [docs/STABILITY.md](docs/STABILITY.md) for what each stage promises and [docs/UPGRADING.md](docs/UPGRADING.md) for how to move between releases.

## 0.2.0-beta.1

Published under the `beta` npm tag; `latest` still does not move until 1.0. No breaking API changes: the recorded public API (`api/*.json`) only gained names. Behaviour changes are listed under "Changed", and [docs/UPGRADING.md](docs/UPGRADING.md) says what to check.

### Added

- **`@bunyad/permissions`:** roles, permissions, teams and tenants. Roles and grants live in a scope (`*`, `tenant:7`, `team:42`) and apply in the scopes below it. A check is a bit test: a warm check runs no queries and a cold one runs one statement. Includes the `HasPermissions` model mixin, `permission:` / `permission.any:` / `role:` route middleware, a Gate hook so `Gate.allows('posts.update')` and `@can('posts.update')` in views work, `whereCan` / `whereHasRole` query conditions, `grantMany`, expiring grants, `copyRoles` for tenant onboarding, API tokens that can only narrow their owner, and `permissions:*` commands (`sync`, `warm`, `cache-clear`, `prune`, `rebuild`, `check-routes`, `doctor`). Publish the migration and config with `bunyad publish --tag=permissions-migrations` and `--tag=permissions-config`; table names are configurable. Cache version counters keep many servers in step without clearing anything, and a failing cache falls back to the database. Optional ways to skip the grants query: keep a user's grants in a column on the user row, or carry them as claims in a signed token. `@bunyad/framework` adds `PermissionServiceProvider` (off until `config/permissions.ts` exists) and re-exports the common names.
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
