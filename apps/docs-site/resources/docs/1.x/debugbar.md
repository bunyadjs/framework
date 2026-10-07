---
title: Debug Bar
description: See each request's queries, logs, events and errors in a panel at the bottom of your pages while you develop.
---

# Debug Bar

## Introduction

The debug bar is a panel at the bottom of your pages that shows what the last request did: the SQL it ran and how long each statement took, the logs it wrote, the events it dispatched, the cache it touched, and any error it raised. It records JSON, API and [Inertia](/docs/1.x/inertia) requests too, so you can inspect a request that has no page.

The bar is for development. It is on when the application runs in debug mode, and off in production and in tests. `@bunyad/debugbar` also keeps a history of recent requests, which an AI agent can read through [the MCP server](/docs/1.x/mcp).

## Installation

Install the package as a development dependency:

```shell
bun add -d @bunyad/debugbar@beta
```

Register the provider where you register your other providers:

```ts title="bootstrap/providers.ts"
import { DebugbarServiceProvider } from "@bunyad/debugbar";

// Inside the function that registers your providers:
app.register(DebugbarServiceProvider);
```

Reload any HTML page. The bar appears at the bottom, and every response carries an `X-Debugbar-Id` header. Click an item in the bar to open its panel, and click the ✕ at the end of the tab row to close it again.

The bar decides whether to run in this order:

1. The `enabled` option in `config/debugbar.ts`, when you set it.
2. The `DEBUGBAR` environment variable: `DEBUGBAR=false` turns it off and `DEBUGBAR=true` forces it on.
3. Otherwise, on when the application is in [debug mode](/docs/1.x/errors) and is not running in production or in tests.

:::warning
Do not force the bar on in production. A request's history contains SQL, URLs and request data.
:::

## What the bar shows

The bar summarizes the request: method, path, status, route name, query count and elapsed query time, request time, memory, and counts of exceptions, events, logs and cache operations. Each item opens a tab:

| Tab | Contents |
| --- | --- |
| Messages | Lines you add with `Debugbar.message()` |
| Timeline | The request, your `Debugbar.measure()` spans and every query on one time axis |
| Queries | Each statement with its time and bindings. Duplicate, slow and possible N+1 queries are flagged |
| Request | The route, query string, body, headers, cookies and response headers |
| Events | Events dispatched during the request, with listener counts |
| Logs | Everything written through `@bunyad/log` during the request |
| Cache | Hits, misses, writes and forgets |
| Exceptions | Server errors (status 500 and up) with stack traces |

Requests your page makes afterwards, such as fetches from a single-page app or [Inertia](/docs/1.x/inertia) visits, are added to a dropdown on the bar. Pick one to inspect it.

The bar is only added to HTML responses that contain a closing `</body>` tag. Redirects and downloads are not changed, but their requests are still recorded.

## Adding your own information

`Debugbar.message()` adds a line to the Messages tab, and `Debugbar.measure()` times a block on the Timeline:

```ts
import { Debugbar } from "@bunyad/debugbar";

Debugbar.message("loaded 12 rows");

const report = await Debugbar.measure("build report", () => buildReport());
```

`measure()` returns what your function returns. Both helpers do nothing when the bar is off, so they are safe to leave in your code.

## Reading the Queries tab

The Queries tab lists every statement the request ran. Use the chips above the table to show all of them, only duplicates, only slow ones, or only possible N+1 patterns.

- **Duplicate.** The same SQL with the same values ran more than once in one request.
- **Slow.** The statement took at least `slowQueryMs` (100 ms by default).
- **Possible N+1.** A `select` whose shape ran `nPlusOneThreshold` or more times (5 by default) with different values, for example one query per row of a list. The tab groups each pattern and shows how many times it ran and the total time.

Click a row to see its bindings and to copy the SQL.

### Where a query came from

Each query shows the file and line of your code that issued it. The bar records the call stack at the moment the query starts and keeps the first frame that is yours, skipping `node_modules`, the runtime and the framework itself. Set `queryOrigin: false` to turn this off.

Origin is best-effort. Batched eager-load queries, such as `with("brand")`, are issued by the ORM after the parent query returns, so they have no origin, although the parent query does. A function that ends with `return Model.query().get()` straight after an earlier `await` also loses its own frame. Write `const rows = await Model.query().get(); return rows;` to keep it.

### Elapsed time and summed time

Queries that run in parallel overlap. If five queries of 10 ms run at once, the request waited about 10 ms, not 50. The bar shows the elapsed figure next to the request time, and keeps the summed figure in the tooltip and in the Queries tab header.

A query's time starts when it is issued, so it includes any wait for a free database connection. The Queries tab also shows how many queries were in flight at once. If that is much higher than your connection pool, the extra queries were queueing.

:::tip
The first request after the server starts is much slower than the rest, because connections and caches are cold. Judge timings from the second request. If your development server restarts when you save a file, the next request after each restart is a cold one.
:::

## Jobs, scheduled tasks and commands

Work that is not an HTTP request gets its own history entry too, with its queries, logs, events and errors. Wrap it in `Debugbar.profile()`:

```ts
import { Debugbar } from "@bunyad/debugbar";

await Debugbar.profile("SendReceipt", () => sendReceipt(order), { kind: "job" });
```

`kind` is `job`, `schedule` or `command`. `profile()` returns what your function returns and rethrows what it throws. When the bar is off it only runs your function. Inside a request it adds a Timeline span instead of a separate entry.

[Scheduled tasks](/docs/1.x/scheduling) are recorded automatically, named after the task. [Queued jobs](/docs/1.x/queues) are not wrapped for you, so call `profile()` in the code that runs your queue payloads.

These entries have no page, so there is no bar to show. They appear in the history, as `JOB`, `SCHEDULE` and `COMMAND` rows. A worker or scheduler is a separate process from your web server, so set `driver: "file"` for them to share one history.

## History

The bar keeps the most recent requests, 50 by default (`history`). Three URLs read it:

| URL | Returns |
| --- | --- |
| `/_debugbar` | A page listing the recent requests |
| `/_debugbar/latest` | The newest request as JSON |
| `/_debugbar/{id}` | One request as JSON |

By default the history lives in memory and is lost when the server restarts. To keep it on disk, set `driver: "file"`. Each request is then written as one JSON file under `storage/debugbar`, so the history survives restarts and other processes can read it. Add that directory to `.gitignore`. Snapshots older than `maxAgeHours` (24 by default) are deleted.

Clear the history with the console command:

```shell
bunyad debugbar:clear
```

Writes happen after the response is sent and never fail a request.

## Privacy

The bar records SQL, request bodies, headers, logs and events, so it masks sensitive values before it stores them or shows them to anyone, including an AI agent:

- **By name.** Fields called `password`, `token`, `secret`, `authorization`, `cookie`, `csrf`, `api key`, `card` and similar are masked. So is personal data such as email, phone, address, national id and bank details, unless you set `redactPii: false`. This applies to request bodies, headers, cookies, query strings, event payloads and log context.
- **SQL bindings by column.** A binding is only a value, so the bar works out which column each placeholder belongs to. `WHERE email = ?`, `SET password = ?`, `INSERT INTO contacts (email, phone) VALUES (...)`, `IN (...)` lists, `BETWEEN` and `LIKE` are all understood. Inline string literals for those columns are masked in the SQL text as well. Duplicate and N+1 detection still compare the real values.
- **By shape.** JWTs, password hashes, `Bearer` and `Basic` credentials and long opaque tokens are masked in any field. UUIDs are left alone.
- **Free text.** Log lines, error messages and stack traces have `password=…`, `token: …` and `Bearer …` values masked.
- **URLs.** Secret query values (`?token=…`) and secret route parameters (`/reset/{token}`) are masked in the stored URL and path.

This is pattern-based and best-effort. It cannot recognise a secret in a column it does not know, or in SQL it cannot parse. Add your own patterns with `redact`, or set `captureBindings: false` to keep no query values at all. The SQL, timings and N+1 detection still work without values.

:::warning
Masking reduces what leaks; it does not make the history safe to share. Treat `storage/debugbar` like a log file, and never expose `/_debugbar` outside your own machine.
:::

## Configuration

Create `config/debugbar.ts`. Every option is optional:

```ts title="config/debugbar.ts"
export default {
  driver: "file",
  history: 100,
  slowQueryMs: 50,
  except: ["/health"],
};
```

Then include it in the `config` object in `bootstrap/app.ts`, the same way as your other config files (see [Configuration](/docs/1.x/configuration)):

```ts title="bootstrap/app.ts"
import debugbarConfig from "../config/debugbar.ts";

const app = new Application({
  basePath,
  config: { app: appConfig, debugbar: debugbarConfig },
  router,
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | follows debug mode | Force the bar on or off |
| `path` | `"/_debugbar"` | URL prefix for the history page and JSON |
| `history` | `50` | How many requests to keep |
| `driver` | `"memory"` | `"file"` keeps history on disk |
| `storagePath` | `"storage/debugbar"` | Directory for the file driver, relative to the application |
| `maxAgeHours` | `24` | File driver: delete older entries |
| `store` | none | Your own store object (`put`, `get`, `list`, `clear`), replacing the built-in ones |
| `slowQueryMs` | `100` | Queries at least this slow are flagged |
| `nPlusOneThreshold` | `5` | Repeats of one query shape before it is flagged as N+1 |
| `queryOrigin` | `true` | Record the file and line that issued each query |
| `eventsIgnore` | cache events | Event names the Events tab skips. A trailing `*` matches a prefix |
| `maxRecords` | `500` | Most records kept per tab, per request |
| `except` | `[]` | Path prefixes the bar ignores |
| `redact` | `[]` | Extra name patterns to mask |
| `redactPii` | `true` | Also mask personal data by name |
| `captureBindings` | `true` | `false` hides every query value |
| `inject` | `true` | `false` keeps history and the header but adds no bar |

## Asking an AI agent

With [the MCP server](/docs/1.x/mcp), an AI agent in your editor can read the same history and answer questions such as which queries run in every request, which route is slowest, or whether a page has an N+1. Use `driver: "file"` for this, because the MCP server runs as a separate process and can only read history from disk.
