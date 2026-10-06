# Changelog

All `@bunyad/*` packages and `create-bunyad` share one version number and are released together. See [docs/STABILITY.md](docs/STABILITY.md) for what each stage promises and [docs/UPGRADING.md](docs/UPGRADING.md) for how to move between releases.

## 0.2.0-beta.0 (unreleased)

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

- **`@bunyad/debugbar`:** a development debug bar with queries, timeline, request, logs, cache and exceptions tabs, retained request history, and a `/_debugbar` JSON API. Masks secrets and personal data (including SQL bindings, by column) before anything is stored or sent to an agent. Registers five `debugbar_*` tools with `@bunyad/mcp` so an AI agent can inspect recorded requests. Adds `listenLog()` to `@bunyad/log`, `listenException()` to `@bunyad/core` and `listenDispatched()` to `@bunyad/events`.
- **`@bunyad/mcp`:** one MCP server per app. Packages register tools with `Mcp.tool()`; `bunyad mcp` boots the app and serves them to an AI agent over stdio. Includes argument validation, output caps and stdout protection.
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
