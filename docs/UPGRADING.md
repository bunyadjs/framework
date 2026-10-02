# Upgrading

Every breaking change in a beta (or later) release is listed here with what to change. Patch releases never need steps. Newest first.

## How to use this page

1. Find your current version and read every section above it up to the version you are moving to.
2. Upgrade all `@bunyad/*` packages together, because they share one version: `bun add @bunyad/framework@beta` (or the individual packages you use).
3. Run `bun run typecheck` and your tests. Removed or renamed exports show up as type errors.

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
