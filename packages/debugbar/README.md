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

Secrets (`password`, `token`, `authorization`, `cookie`, `csrf`, …) are masked before anything is stored.

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
  redact: [/ssn/i],     // extra key patterns to mask
  inject: true,         // false: keep history and the header, skip the bar
};
```

## Query insights

- **Duplicate:** identical SQL and bindings ran more than once in the request.
- **Possible N+1:** a `select`/`with` statement whose shape (values stripped) ran `nPlusOneThreshold` or more times with different bindings. Writes are never flagged. The Queries tab lists each pattern with its count, total time and origin.
- **Origin:** the first stack frame outside `node_modules`, the runtime and the framework's own `src/`. It is captured only while the bar is on; set `queryOrigin: false` to skip the stack capture.

## Notes

- Never enable it in production: snapshots contain SQL, URLs and request data.
- Pages whose HTML has no closing `</body>` tag, redirects and downloads are not injected; their snapshots are still stored.
- Errors rendered by your exception handler still get the bar, because the middleware sees the rendered response.
