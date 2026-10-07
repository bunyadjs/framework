# @bunyad/debugbar

A development debug bar: a bottom panel injected into your HTML pages, plus retained history for JSON, API and Inertia requests.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add -d @bunyad/debugbar@beta
# or: npm install -D @bunyad/debugbar@beta
```

## Usage

```ts
import { DebugbarServiceProvider } from "@bunyad/debugbar";

app.register(DebugbarServiceProvider);
```

That is all. The bar is on in debug mode, and off in production and in unit tests. Set `DEBUGBAR=false` to turn it off, or `DEBUGBAR=true` to force it on.

Every response carries an `X-Debugbar-Id` header. The bar patches `fetch` and `XMLHttpRequest`, so requests your pages make (SPA calls, Inertia visits) appear in the dropdown on the bar.

## What it shows

| Tab | Contents |
|---|---|
| Messages | Lines you add with `Debugbar.message()` |
| Timeline | Request, `Debugbar.measure()` spans and queries on one time axis |
| Queries | SQL, bindings and timing; duplicate, slow and possible N+1 queries flagged, each with the file and line that issued it; filter chips |
| Request | General, route, query, body, headers, cookies, response headers |
| Events | Events dispatched during the request, with listener counts, timing and a redacted payload; events nobody listens to are called out |
| Logs | `@bunyad/log` calls made during the request |
| Cache | Hits, misses, writes and forgets |
| Exceptions | Server errors (status 500 and up) with stack traces |

Secrets and personal data are masked before anything is stored or sent to an agent; see [Privacy](#privacy).

## Your own code

```ts
import { Debugbar } from "@bunyad/debugbar";

Debugbar.message("loaded 12 rows");
const rows = await Debugbar.measure("build report", () => buildReport());
```

These are no-ops when the bar is off, so they are safe to leave in.

## Endpoints

| Route | Returns |
|---|---|
| `GET /_debugbar` | History page |
| `GET /_debugbar/latest` | Newest snapshot (JSON) |
| `GET /_debugbar/:id` | One snapshot (JSON) |

## Configuration

Put these in `config/debugbar.ts` (all optional):

```ts
export default {
  enabled: undefined,   // force on/off; default follows debug mode
  path: "/_debugbar",
  history: 50,          // requests kept in memory
  slowQueryMs: 100,
  nPlusOneThreshold: 5, // flag a read repeated this many times with different bindings
  queryOrigin: true,    // record the file:line that issued each query
  eventsIgnore: ["CacheHit"], // names the Events tab skips (trailing * = prefix); cache events are skipped by default
  maxRecords: 500,      // per collector, per request
  except: ["/health"],  // path prefixes the bar ignores
  redact: [/loyalty/i], // extra key patterns to mask (columns, fields, query and route parameters)
  redactPii: true,      // also mask email, phone, address, ids and bank details by name (default)
  captureBindings: true, // false: hide every query value; SQL, timing and N+1 detection still work
  inject: true,         // false: keep history and the header, skip the bar
  driver: "memory",     // "file": keep history on disk (see below)
  storagePath: "storage/debugbar", // file driver, relative to the app base path
  maxAgeHours: 24,      // file driver: delete older snapshots
};
```

## AI agents (MCP)

With `@bunyad/mcp`, the history is also available to an AI agent in your editor, which can answer questions like "what was the slowest request in the last hour?" or "is there an N+1 on the products page?" from real recorded requests. The tools are registered when the bar is on. The first group looks at one request; `debugbar_hot_queries` and `debugbar_routes` look at all of them, so raise `history` (default 50) to analyse a longer session:

| Tool | Use |
|---|---|
| `debugbar_list_requests` | Recent requests with status, time and problem counts; filter by method, status, path, slowness, exceptions or N+1. Start here for an id. |
| `debugbar_get_request` | One request summarized with what looks wrong; pass `sections` for detail or a JSON Pointer for one exact value. |
| `debugbar_queries` | The SQL with timing, bindings and the file:line that ran it; filter to duplicates, slow or N+1. |
| `debugbar_hot_queries` | Query shapes ranked **across all recorded requests**: what runs in every request, how often, and the total time. This is where a permission or tenant lookup that is cheap alone but runs ten times per page shows up. |
| `debugbar_routes` | Per-route totals: hits, average and worst time, average queries, duplicates, N+1, server errors, peak queries in flight. Finds the slow, chatty or failing endpoints. |
| `debugbar_exceptions` | Server errors with stack traces, for one request or the recent ones. |
| `debugbar_logs` | Log lines from one request, from a minimum level up. |

**Use `driver: "file"`.** The MCP server is a separate process, so it can only see history on disk; with the default memory driver every tool answers that no history is visible and says how to fix it. See the [`@bunyad/mcp`](../mcp/README.md) README for connecting an editor.

Responses are summaries, with SQL cut at 300 characters and stacks at 15 lines, so a question doesn't flood the agent's context. Everything was redacted before it was stored.

## History storage

By default history lives in memory and is lost when the server restarts. With `driver: "file"` each request is written as one JSON file under `storage/debugbar` (directory `0700`, files `0600`), so history survives `--watch` restarts and other processes, such as a future MCP server, can read it. Writes happen after the response is sent and never fail a request. Add the directory to `.gitignore`.

`bunyad debugbar:clear` empties the history. Pass your own object as `store` to replace the storage entirely (`put`, `get`, `list`, `clear`; sync or async).

## Reading query times

- **Elapsed vs summed.** Queries that run in parallel overlap, so the bar shows the *elapsed* time and keeps the summed figure in the tooltip.
- **Pool waits.** A query's time starts when it is issued and includes any wait for a free database connection. The Queries tab shows how many were in flight at once (`peakInFlight`); if that is well above your connection pool size, most of those queries were queueing and the SQL itself is not the slow part. Raise the pool, or issue fewer queries at once, before tuning the SQL.

## Jobs, scheduled tasks and commands

Work that is not an HTTP request gets its own history entry too, with its queries, logs, events and errors:

```ts
import { Debugbar } from "@bunyad/debugbar";

await Debugbar.profile("SendReceipt", () => sendReceipt(order), { kind: "job" }); // or "schedule" / "command"
```

- **Scheduled tasks** (`@bunyad/schedule`) are recorded automatically, named after the task.
- **Queued jobs, commands and other work** are recorded when you wrap them in `Debugbar.profile()`, for example in the code that runs your queue payloads. `@bunyad/queue` does not do this for you yet.
- `profile()` returns what your function returns and rethrows what it throws. When the bar is off it only runs your function. Inside a request it adds a Timeline span instead of a separate entry.
- Entries appear on the history page as `JOB` / `SCHEDULE` / `COMMAND` rows, and `debugbar_list_requests` takes a `kind` filter. They have no page, so there is no bar to show.
- A worker or scheduler is a separate process from your web server, so use `driver: "file"` for them to share one history.

## Privacy

The bar records SQL, request bodies, headers, logs and events. Everything is masked **before** it reaches the bar, the history files or an MCP agent:

- **By name:** `password`, `token`, `secret`, `authorization`, `cookie`, `csrf`, `api key`, `card` and similar, plus personal data (email, phone, address, national id, bank details) unless `redactPii: false`. This applies to request bodies, headers, cookies, query strings, event payloads, log context and your own `redact` patterns.
- **SQL bindings by column.** A binding is a bare value, so the bar works out which column each `?` or `$1` belongs to: `WHERE email = ?`, `SET password = ?`, `INSERT INTO t (email, phone) VALUES (...)` (including several rows), `IN (...)` lists, `BETWEEN` and `LIKE`. Inline string literals for those columns are masked in the SQL text too. Duplicate and N+1 detection still work on the real values.
- **By shape:** JWTs, password hashes, `Bearer`/`Basic` credentials and long opaque tokens are masked in any field. UUIDs are not.
- **Free text:** log lines, error messages and stacks have `password=...`, `token: ...` and `Bearer ...` values masked.
- **URLs:** secret query values (`?token=...`) and secret route parameters (`/reset/{token}`) are masked in the stored url and path.

This is pattern-based and best-effort. It cannot recognise a secret in a column it does not know, or in SQL it cannot parse (a few vendor-specific forms). If that is not enough for your data, add your own `redact` patterns, or set `captureBindings: false` so no query value is kept at all.

## Query insights

- **Duplicate:** identical SQL and bindings ran more than once in the request.
- **Possible N+1:** a `select`/`with` statement whose shape (values stripped) ran `nPlusOneThreshold` or more times with different bindings. Writes are never flagged. The Queries tab lists each pattern with its count, total time and origin.
- **Origin:** the file and line of your code that issued each query, taken from the stack captured at the moment the query was issued (the database layer hands it over; by the time a query finishes, an async driver's stack no longer contains your code). Frames inside `node_modules`, the runtime and the framework's own `src/` are skipped. It is captured only while the bar is on; set `queryOrigin: false` to skip the capture. **Best-effort, with known gaps:**
  - Batched **eager-load** queries (`with('brand')`) are issued by the ORM after the parent query returns, so they have no origin. The parent query does.
  - A function that ends with `return Model.query().get()` right after an earlier `await` loses its own frame (JavaScriptCore drops the caller of a tail call). Write `const rows = await ...; return rows;` to keep it.

## Notes

- Never enable it in production: snapshots contain SQL, URLs and request data.
- Pages whose HTML has no closing `</body>` tag, redirects and downloads are not injected; their snapshots are still stored.
- Errors rendered by your exception handler still get the bar, because the middleware sees the rendered response.
