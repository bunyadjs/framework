# Upgrading

Every breaking change in a beta (or later) release is listed here with what to change. Patch releases never need steps. Newest first.

## How to use this page

1. Find your current version and read every section above it up to the version you are moving to.
2. Upgrade all `@bunyad/*` packages together, because they share one version: `bun add @bunyad/framework@beta` (or the individual packages you use).
3. Run `bun run typecheck` and your tests. Removed or renamed exports show up as type errors.

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
